const express = require('express');
const axios = require('axios');
const cors = require('cors');
const os = require('os');
const http = require('http');
const https = require('https');

const app = express();
const PORT = 2456;

app.use(cors());

// === Configuration ===
const CONFIG = {
    MIN_INTERVAL: 60000,        // 1 minute minimum
    MAX_INTERVAL: 600000,       // 10 minutes maximum
    DEFAULT_INTERVAL: 120000,   // 2 minutes default
    ACTIVE_INTERVAL: 60000,     // 1 minute when changes detected
    QUIET_INTERVAL: 300000,     // 5 minutes when quiet
    CONCURRENT_PAGES: 3,        // Parallel page requests
    CHANGES_RETENTION: 100,
    ACTIVITY_WINDOW: 3600000,   // 1 hour for activity tracking
    PEAK_HOURS_START: 6,        // 6 AM
    PEAK_HOURS_END: 22,         // 10 PM
};

// === Axios Instance with Keep-Alive ===
const axiosInstance = axios.create({
    httpAgent: new http.Agent({ 
        keepAlive: true,
        maxSockets: 10,
        maxFreeSockets: 5,
        timeout: 60000,
        keepAliveMsecs: 30000
    }),
    httpsAgent: new https.Agent({ 
        keepAlive: true,
        maxSockets: 10,
        maxFreeSockets: 5,
        timeout: 60000,
        keepAliveMsecs: 30000
    }),
    timeout: 15000
});

// === Circuit Breaker ===
class CircuitBreaker {
    constructor(threshold = 5, timeout = 60000) {
        this.failures = 0;
        this.threshold = threshold;
        this.timeout = timeout;
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.nextAttempt = Date.now();
        this.successCount = 0;
    }
    
    async execute(fn) {
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                throw new Error(`Circuit breaker OPEN. Retry after ${new Date(this.nextAttempt).toISOString()}`);
            }
            this.state = 'HALF_OPEN';
            this.successCount = 0;
        }
        
        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }
    
    onSuccess() {
        if (this.state === 'HALF_OPEN') {
            this.successCount++;
            if (this.successCount >= 3) {
                this.state = 'CLOSED';
                this.failures = 0;
            }
        } else {
            this.failures = Math.max(0, this.failures - 1);
        }
    }
    
    onFailure() {
        this.failures++;
        this.successCount = 0;
        
        if (this.failures >= this.threshold) {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.timeout;
            console.warn(`[CircuitBreaker] Opening circuit. Failures: ${this.failures}`);
        }
    }
    
    getState() {
        return {
            state: this.state,
            failures: this.failures,
            nextAttempt: this.state === 'OPEN' ? new Date(this.nextAttempt).toISOString() : null
        };
    }
}

// === Monitoring State ===
const monitoringJobs = new Map();
const circuitBreakers = new Map(); // One per job

// === User-Agent Pool ===
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function delay(ms) { 
    return new Promise(resolve => setTimeout(resolve, ms)); 
}

function randomDelay(min = 500, max = 1500) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return delay(ms);
}

// === Helper Functions ===
function normalizeUrl(url) {
    try {
        const urlObj = new URL(url);
        const params = Array.from(urlObj.searchParams.entries()).sort();
        urlObj.search = '';
        params.forEach(([key, value]) => urlObj.searchParams.append(key, value));
        return urlObj.toString();
    } catch (e) {
        return url;
    }
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(2)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(2)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
}

function buildUrlWithPage(baseUrl, pageNumber) {
    const url = new URL(baseUrl);
    url.searchParams.set('page', pageNumber);
    return url.toString();
}

function rebuildUrl(req) {
    const baseUrl = req.query.url;
    const otherParams = [];
    for (const key in req.query) {
        if (key === 'url' || key === 'interval' || key === 'clear' || key === 'webhook') continue;
        const encodedKey = encodeURIComponent(key);
        const encodedValue = encodeURIComponent(req.query[key]);
        otherParams.push(`${encodedKey}=${encodedValue}`);
    }
    return baseUrl + (otherParams.length > 0 ? '&' + otherParams.join('&') : '');
}

function setsEqual(set1, set2) {
    if (set1.size !== set2.size) return false;
    for (const item of set1) {
        if (!set2.has(item)) return false;
    }
    return true;
}

function isPeakHours() {
    const hour = new Date().getHours();
    return hour >= CONFIG.PEAK_HOURS_START && hour < CONFIG.PEAK_HOURS_END;
}

// === Adaptive Interval Logic ===
function calculateNextInterval(job) {
    const now = Date.now();
    const recentChanges = job.changes.filter(c => 
        now - new Date(c.timestamp).getTime() < CONFIG.ACTIVITY_WINDOW
    ).length;
    
    // Activity-based adjustment
    let interval;
    if (recentChanges > 5) {
        interval = CONFIG.ACTIVE_INTERVAL; // Hot market - 1 min
    } else if (recentChanges > 0) {
        interval = CONFIG.DEFAULT_INTERVAL; // Some activity - 2 min
    } else {
        interval = CONFIG.QUIET_INTERVAL; // Quiet - 5 min
    }
    
    // Time-based adjustment (slower at night)
    if (!isPeakHours()) {
        interval = Math.min(interval * 1.5, CONFIG.MAX_INTERVAL);
    }
    
    // Error-based backoff
    if (job.consecutiveErrors > 0) {
        const backoffMultiplier = Math.pow(2, Math.min(job.consecutiveErrors, 4));
        interval = Math.min(interval * backoffMultiplier, CONFIG.MAX_INTERVAL);
    }
    
    return Math.max(interval, CONFIG.MIN_INTERVAL);
}

// === Resource Monitoring ===
function getSystemSnapshot() {
    const mem = process.memoryUsage();
    return {
        timestamp: new Date().toISOString(),
        cpu: process.cpuUsage(),
        memory: {
            rss: mem.rss,
            heapTotal: mem.heapTotal,
            heapUsed: mem.heapUsed,
            external: mem.external,
            arrayBuffers: mem.arrayBuffers
        }
    };
}

function diffUsage(start, end) {
    const cpuDiffUserMs = (end.cpu.user - start.cpu.user) / 1000;
    const cpuDiffSystemMs = (end.cpu.system - start.cpu.system) / 1000;
    const totalCpuMs = cpuDiffUserMs + cpuDiffSystemMs;

    const durationMs = Date.now() - new Date(start.timestamp).getTime();

    return {
        cpu: {
            totalMs: totalCpuMs,
            formatted: `${totalCpuMs.toFixed(2)} ms`
        },
        memory: {
            rss: formatBytes(end.memory.rss),
            heapUsed: formatBytes(end.memory.heapUsed),
            heapTotal: formatBytes(end.memory.heapTotal)
        },
        duration: {
            ms: durationMs,
            formatted: `${(durationMs / 1000).toFixed(2)} s`
        }
    };
}

// === Scraping Functions ===
async function scrapeWillhabenPage(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const userAgent = getRandomUserAgent();
            const { data: html } = await axiosInstance.get(url, {
                headers: { 'User-Agent': userAgent }
            });

            const jsonString = html.substring(
                html.indexOf('<script id="__NEXT_DATA__" type="application/json">') + '<script id="__NEXT_DATA__" type="application/json">'.length,
                html.indexOf('</script>', html.indexOf('<script id="__NEXT_DATA__" type="application/json">'))
            );

            const result = JSON.parse(jsonString);
            const searchResult = result.props.pageProps.searchResult;
            const listings = searchResult.advertSummaryList.advertSummary;

            const formattedListings = listings.map(listing => {
                const formatted = {
                    id: listing.id,
                    description: listing.description,
                    url: null,
                    image_urls: []
                };

                // Extract the proper listing URL from contextLinkList
                // Try to find the SEO-friendly URL (not the API URL)
                if (listing.contextLinkList?.contextLink && listing.contextLinkList.contextLink.length > 0) {
                    // Look for the website URL (not API URL)
                    const webLink = listing.contextLinkList.contextLink.find(link => 
                        link.uri && !link.uri.includes('api.willhaben') && !link.uri.includes('/restapi/')
                    );
                    
                    if (webLink) {
                        const uri = webLink.uri;
                        formatted.url = uri.startsWith('http') ? uri : `https://www.willhaben.at${uri}`;
                    } else {
                        // Fallback: construct URL from ID and description
                        // Format: /iad/[category]/d/[slug]-[id]
                        const slug = listing.description
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, '-')
                            .replace(/^-|-$/g, '')
                            .substring(0, 50); // Limit slug length
                        
                        // Determine category from attributes or use generic
                        let category = 'kaufen-und-verkaufen'; // default marktplatz
                        
                        // Try to detect category from listing attributes
                        if (listing.attributes?.attribute) {
                            const categoryAttr = listing.attributes.attribute.find(a => 
                                a.name.toLowerCase().includes('category') || 
                                a.name.toLowerCase().includes('section')
                            );
                            if (categoryAttr?.values?.[0]) {
                                const catValue = categoryAttr.values[0].toLowerCase();
                                if (catValue.includes('immo') || catValue.includes('wohnung') || catValue.includes('haus')) {
                                    category = 'immobilien';
                                } else if (catValue.includes('auto') || catValue.includes('fahrzeug')) {
                                    category = 'auto';
                                } else if (catValue.includes('job')) {
                                    category = 'jobs';
                                }
                            }
                        }
                        
                        formatted.url = `https://www.willhaben.at/iad/${category}/d/${slug}-${listing.id}`;
                    }
                }

                if (listing.advertImageList?.advertImage) {
                    formatted.image_urls = listing.advertImageList.advertImage.map(img => img.url);
                }

                listing.attributes.attribute.forEach(element => {
                    const key = element.name.toLowerCase().replace('/', '_');
                    const value = element.values[0];
                    formatted[key] = isNaN(value) ? value : Number(value);
                });

                return formatted;
            });

            return {
                totalListings: searchResult.numFound,
                listingsPerPage: searchResult.rows,
                currentPage: searchResult.page,
                listings: formattedListings
            };
        } catch (error) {
            if (attempt < retries) {
                await delay(Math.min(1000 * Math.pow(2, attempt), 10000));
            } else {
                throw new Error(`Failed after ${retries} attempts: ${error.message}`);
            }
        }
    }
}

// === Optimized Parallel Scraping ===
async function scrapeAllPagesParallel(baseUrl, fastMode = false) {
    const allListings = new Map();
    
    // Always scrape first page
    const firstPage = await scrapeWillhabenPage(baseUrl);
    firstPage.listings.forEach(l => allListings.set(l.id, l));
    
    const totalListings = firstPage.totalListings;
    const listingsPerPage = firstPage.listingsPerPage;
    const totalPages = Math.ceil(totalListings / listingsPerPage);
    
    // Fast mode: only first page (for quick checks)
    if (fastMode || totalPages === 1) {
        return {
            totalListings,
            scrapedListings: allListings.size,
            pagesScraped: 1,
            listings: Array.from(allListings.values()),
            fastMode
        };
    }
    
    // Scrape remaining pages in parallel batches
    const concurrency = CONFIG.CONCURRENT_PAGES;
    for (let i = 2; i <= totalPages; i += concurrency) {
        const batch = [];
        for (let j = i; j < i + concurrency && j <= totalPages; j++) {
            batch.push(scrapeWillhabenPage(buildUrlWithPage(baseUrl, j)));
        }
        
        const results = await Promise.allSettled(batch);
        results.forEach(r => {
            if (r.status === 'fulfilled') {
                r.value.listings.forEach(l => allListings.set(l.id, l));
            }
        });
        
        // Small delay between batches to be polite
        if (i + concurrency <= totalPages) {
            await randomDelay(500, 1000);
        }
    }
    
    return {
        totalListings,
        scrapedListings: allListings.size,
        pagesScraped: totalPages,
        listings: Array.from(allListings.values()),
        fastMode: false
    };
}

// === Change Detection ===
function detectChanges(oldListings, newListings) {
    const changes = [];
    const oldMap = new Map(oldListings.map(l => [l.id, l]));
    const newMap = new Map(newListings.map(l => [l.id, l]));

    // New listings
    for (const [id, listing] of newMap) {
        if (!oldMap.has(id)) {
            changes.push({
                type: 'NEW_LISTING',
                timestamp: new Date().toISOString(),
                listingId: id,
                listing: listing
            });
        }
    }

    // Removed listings
    for (const [id, listing] of oldMap) {
        if (!newMap.has(id)) {
            changes.push({
                type: 'REMOVED_LISTING',
                timestamp: new Date().toISOString(),
                listingId: id,
                listing: listing
            });
        }
    }

    // Price and description changes
    for (const [id, newListing] of newMap) {
        if (oldMap.has(id)) {
            const oldListing = oldMap.get(id);
            
            if (oldListing.price !== undefined && newListing.price !== undefined && 
                oldListing.price !== newListing.price) {
                changes.push({
                    type: 'PRICE_CHANGE',
                    timestamp: new Date().toISOString(),
                    listingId: id,
                    listing: newListing,
                    oldPrice: oldListing.price,
                    newPrice: newListing.price,
                    priceChange: newListing.price - oldListing.price
                });
            }

            if (oldListing.description !== newListing.description) {
                changes.push({
                    type: 'DESCRIPTION_CHANGE',
                    timestamp: new Date().toISOString(),
                    listingId: id,
                    listing: newListing,
                    oldDescription: oldListing.description,
                    newDescription: newListing.description
                });
            }
        }
    }

    return changes;
}

// === Webhook ===
async function sendToWebhook(webhookUrl, changes, jobInfo) {
    if (!webhookUrl) return;
    
    try {
        const payload = {
            timestamp: new Date().toISOString(),
            monitoredUrl: jobInfo.originalUrl,
            changes: changes,
            changesCount: changes.length,
            changesSummary: {
                newListings: changes.filter(c => c.type === 'NEW_LISTING').length,
                removedListings: changes.filter(c => c.type === 'REMOVED_LISTING').length,
                priceChanges: changes.filter(c => c.type === 'PRICE_CHANGE').length,
                descriptionChanges: changes.filter(c => c.type === 'DESCRIPTION_CHANGE').length
            },
            monitoringInfo: {
                checkCount: jobInfo.checkCount,
                lastCheck: jobInfo.lastCheck,
                currentListingsCount: jobInfo.lastSnapshot?.length || 0,
                nextInterval: jobInfo.currentInterval
            }
        };

        await axiosInstance.post(webhookUrl, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
        });
        
        console.log(`[Webhook] Successfully sent ${changes.length} changes to webhook`);
    } catch (error) {
        console.error(`[Webhook] Failed to send:`, error.message);
    }
}

// === Smart Monitoring Check ===
async function performSmartMonitoringCheck(normalizedUrl) {
    const job = monitoringJobs.get(normalizedUrl);
    if (!job) return;

    const breaker = circuitBreakers.get(normalizedUrl);
    
    try {
        await breaker.execute(async () => {
            // Quick check: only first page
            const firstPageData = await scrapeWillhabenPage(job.originalUrl);
            const firstPageIds = new Set(firstPageData.listings.map(l => l.id));
            
            let needsFullScrape = false;
            
            if (job.lastSnapshot && job.lastSnapshot.length > 0) {
                // Compare first page IDs with previous first page
                const pageSize = firstPageData.listingsPerPage;
                const oldFirstPageIds = new Set(
                    job.lastSnapshot.slice(0, pageSize).map(l => l.id)
                );
                
                // If first page changed, do full scrape
                needsFullScrape = !setsEqual(firstPageIds, oldFirstPageIds);
            } else {
                // Initial check, need full scrape
                needsFullScrape = true;
            }
            
            let newListings;
            let scrapingStats;
            
            if (needsFullScrape) {
                console.log(`[Monitor] Changes detected on first page for ${normalizedUrl}, doing full scrape...`);
                const fullData = await scrapeAllPagesParallel(job.originalUrl, false);
                newListings = fullData.listings;
                scrapingStats = {
                    mode: 'full',
                    pagesScraped: fullData.pagesScraped,
                    listingsFound: fullData.scrapedListings
                };
            } else {
                // Fast path: no changes
                newListings = job.lastSnapshot;
                scrapingStats = {
                    mode: 'fast',
                    pagesScraped: 1,
                    listingsFound: firstPageData.listings.length
                };
                console.log(`[Monitor] No changes on first page for ${normalizedUrl}, skipping full scrape`);
            }

            // Detect changes if we have previous data
            let detectedChanges = [];
            if (job.lastSnapshot && job.lastSnapshot.length > 0 && needsFullScrape) {
                detectedChanges = detectChanges(job.lastSnapshot, newListings);
                
                if (detectedChanges.length > 0) {
                    job.changes.push(...detectedChanges);
                    
                    if (job.webhookUrl) {
                        await sendToWebhook(job.webhookUrl, detectedChanges, job);
                    }
                    
                    if (job.changes.length > CONFIG.CHANGES_RETENTION) {
                        job.changes = job.changes.slice(-CONFIG.CHANGES_RETENTION);
                    }
                    
                    console.log(`[Monitor] Detected ${detectedChanges.length} changes for ${normalizedUrl}`);
                }
            }

            // Update job state
            job.lastSnapshot = newListings;
            job.lastCheck = new Date().toISOString();
            job.checkCount = (job.checkCount || 0) + 1;
            job.consecutiveErrors = 0;
            job.lastError = null;
            job.lastScrapingStats = scrapingStats;
            
            // Calculate and schedule next interval
            const nextInterval = calculateNextInterval(job);
            job.currentInterval = nextInterval;
            
            // Reschedule with new interval
            rescheduleJob(normalizedUrl, nextInterval);
        });
        
    } catch (error) {
        console.error(`[Monitor] Error checking ${normalizedUrl}:`, error.message);
        job.consecutiveErrors = (job.consecutiveErrors || 0) + 1;
        job.lastError = {
            message: error.message,
            timestamp: new Date().toISOString(),
            consecutiveErrors: job.consecutiveErrors
        };
        
        // Reschedule with backoff
        const nextInterval = calculateNextInterval(job);
        job.currentInterval = nextInterval;
        rescheduleJob(normalizedUrl, nextInterval);
    }
}

function rescheduleJob(normalizedUrl, newInterval) {
    const job = monitoringJobs.get(normalizedUrl);
    if (!job) return;
    
    // Clear existing interval
    if (job.intervalId) {
        clearInterval(job.intervalId);
    }
    
    // Set new interval
    job.intervalId = setInterval(() => {
        performSmartMonitoringCheck(normalizedUrl);
    }, newInterval);
}

// === Endpoints ===
app.get('/getListings', async (req, res) => {
    const baseUrl = req.query.url;
    if (!baseUrl) return res.status(400).json({ error: 'A "url" query parameter is required.' });

    const fullUrl = rebuildUrl(req);
    const startSnapshot = getSystemSnapshot();

    try {
        const scrapeData = await scrapeWillhabenPage(fullUrl);
        const endSnapshot = getSystemSnapshot();
        const usage = diffUsage(startSnapshot, endSnapshot);

        res.status(200).json({
            ...scrapeData,
            systemInfo: {
                started: startSnapshot.timestamp,
                finished: endSnapshot.timestamp,
                usage
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/getAllListings', async (req, res) => {
    const baseUrl = req.query.url;
    if (!baseUrl) return res.status(400).json({ error: 'A "url" query parameter is required.' });

    const fullUrl = rebuildUrl(req);
    const startSnapshot = getSystemSnapshot();

    try {
        const allData = await scrapeAllPagesParallel(fullUrl, false);
        const endSnapshot = getSystemSnapshot();
        const usage = diffUsage(startSnapshot, endSnapshot);

        res.status(200).json({
            ...allData,
            systemInfo: {
                started: startSnapshot.timestamp,
                finished: endSnapshot.timestamp,
                usage
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/startMonitoring', async (req, res) => {
    const baseUrl = req.query.url;
    const intervalMinutes = parseInt(req.query.interval) || null;
    const webhookUrl = req.query.webhook || null;
    
    if (!baseUrl) {
        return res.status(400).json({ error: 'A "url" query parameter is required.' });
    }

    const fullUrl = rebuildUrl(req);
    const normalizedUrl = normalizeUrl(fullUrl);

    // Stop existing monitoring if any
    if (monitoringJobs.has(normalizedUrl)) {
        const oldJob = monitoringJobs.get(normalizedUrl);
        clearInterval(oldJob.intervalId);
    }

    // Create circuit breaker for this job
    if (!circuitBreakers.has(normalizedUrl)) {
        circuitBreakers.set(normalizedUrl, new CircuitBreaker(5, 60000));
    }

    // Determine initial interval
    const initialInterval = intervalMinutes 
        ? Math.max(intervalMinutes * 60 * 1000, CONFIG.MIN_INTERVAL)
        : CONFIG.DEFAULT_INTERVAL;

    // Create new monitoring job
    const job = {
        originalUrl: fullUrl,
        normalizedUrl: normalizedUrl,
        webhookUrl: webhookUrl,
        currentInterval: initialInterval,
        lastSnapshot: [],
        changes: [],
        startedAt: new Date().toISOString(),
        lastCheck: null,
        checkCount: 0,
        consecutiveErrors: 0,
        lastError: null,
        lastScrapingStats: null,
        intervalId: null
    };

    monitoringJobs.set(normalizedUrl, job);

    // Perform initial check
    try {
        await performSmartMonitoringCheck(normalizedUrl);
        
        const nextCheckTime = new Date(Date.now() + job.currentInterval).toISOString();

        res.status(200).json({
            message: 'Monitoring started successfully',
            normalizedUrl: normalizedUrl,
            webhookUrl: webhookUrl || 'Not configured',
            checkInterval: `${(job.currentInterval / 60000).toFixed(1)} minutes (adaptive)`,
            initialListings: job.lastSnapshot?.length || 0,
            nextCheck: nextCheckTime,
            configuration: {
                minInterval: `${CONFIG.MIN_INTERVAL / 60000} minutes`,
                maxInterval: `${CONFIG.MAX_INTERVAL / 60000} minutes`,
                adaptiveMode: 'enabled',
                peakHours: `${CONFIG.PEAK_HOURS_START}:00 - ${CONFIG.PEAK_HOURS_END}:00`
            }
        });
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to start monitoring',
            details: error.message 
        });
    }
});

app.get('/stopMonitoring', (req, res) => {
    const baseUrl = req.query.url;
    
    if (!baseUrl) {
        return res.status(400).json({ error: 'A "url" query parameter is required.' });
    }

    const fullUrl = rebuildUrl(req);
    const normalizedUrl = normalizeUrl(fullUrl);

    if (!monitoringJobs.has(normalizedUrl)) {
        return res.status(404).json({ 
            error: 'No monitoring job found for this URL',
            normalizedUrl: normalizedUrl,
            availableJobs: Array.from(monitoringJobs.keys())
        });
    }

    const job = monitoringJobs.get(normalizedUrl);
    clearInterval(job.intervalId);
    monitoringJobs.delete(normalizedUrl);
    circuitBreakers.delete(normalizedUrl);

    res.status(200).json({
        message: 'Monitoring stopped successfully',
        normalizedUrl: normalizedUrl,
        totalChecks: job.checkCount,
        totalChangesDetected: job.changes.length
    });
});

app.get('/getChanges', (req, res) => {
    const baseUrl = req.query.url;
    const clearAfterRead = req.query.clear === 'true';
    
    if (!baseUrl) {
        return res.status(400).json({ error: 'A "url" query parameter is required.' });
    }

    const fullUrl = rebuildUrl(req);
    const normalizedUrl = normalizeUrl(fullUrl);

    if (!monitoringJobs.has(normalizedUrl)) {
        return res.status(404).json({ 
            error: 'No monitoring job found for this URL',
            requestedUrl: fullUrl,
            normalizedUrl: normalizedUrl,
            availableJobs: Array.from(monitoringJobs.keys())
        });
    }

    const job = monitoringJobs.get(normalizedUrl);
    const breaker = circuitBreakers.get(normalizedUrl);
    const changes = [...job.changes];
    
    if (clearAfterRead) {
        job.changes = [];
    }

    res.status(200).json({
        normalizedUrl: normalizedUrl,
        monitoringStatus: {
            startedAt: job.startedAt,
            lastCheck: job.lastCheck,
            checkCount: job.checkCount,
            currentInterval: `${(job.currentInterval / 60000).toFixed(1)} minutes`,
            currentListingsCount: job.lastSnapshot?.length || 0,
            consecutiveErrors: job.consecutiveErrors,
            lastError: job.lastError,
            webhookUrl: job.webhookUrl || 'Not configured',
            lastScrapingStats: job.lastScrapingStats,
            circuitBreaker: breaker ? breaker.getState() : null
        },
        changes: changes,
        changesCount: changes.length
    });
});

app.get('/getMonitoringStatus', (req, res) => {
    const activeJobs = [];

    for (const [url, job] of monitoringJobs) {
        const breaker = circuitBreakers.get(url);
        activeJobs.push({
            normalizedUrl: url,
            originalUrl: job.originalUrl,
            webhookUrl: job.webhookUrl || 'Not configured',
            startedAt: job.startedAt,
            lastCheck: job.lastCheck,
            checkCount: job.checkCount,
            currentInterval: `${(job.currentInterval / 60000).toFixed(1)} minutes`,
            currentListingsCount: job.lastSnapshot?.length || 0,
            pendingChanges: job.changes.length,
            consecutiveErrors: job.consecutiveErrors,
            lastError: job.lastError,
            lastScrapingStats: job.lastScrapingStats,
            circuitBreaker: breaker ? breaker.getState() : null,
            nextCheck: new Date(Date.now() + job.currentInterval).toISOString()
        });
    }

    res.status(200).json({
        activeMonitors: activeJobs.length,
        jobs: activeJobs,
        configuration: {
            minInterval: `${CONFIG.MIN_INTERVAL / 60000} minutes`,
            maxInterval: `${CONFIG.MAX_INTERVAL / 60000} minutes`,
            defaultInterval: `${CONFIG.DEFAULT_INTERVAL / 60000} minutes`,
            concurrentPages: CONFIG.CONCURRENT_PAGES,
            peakHours: `${CONFIG.PEAK_HOURS_START}:00 - ${CONFIG.PEAK_HOURS_END}:00`,
            isPeakHours: isPeakHours()
        }
    });
});

// Cleanup on server shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    for (const [url, job] of monitoringJobs) {
        clearInterval(job.intervalId);
    }
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`╔════════════════════════════════════════════════════════════════╗`);
    console.log(`║  Optimized Willhaben Scraper API - Running on Port ${PORT}      ║`);
    console.log(`╚════════════════════════════════════════════════════════════════╝`);
    console.log(`\n📊 Basic Endpoints:`);
    console.log(`  GET /getListings?url=YOUR_URL`);
    console.log(`  GET /getAllListings?url=YOUR_URL`);
    console.log(`\n🔄 Monitoring Endpoints:`);
    console.log(`  GET /startMonitoring?url=YOUR_URL&webhook=YOUR_WEBHOOK`);
    console.log(`  GET /stopMonitoring?url=YOUR_URL`);
    console.log(`  GET /getChanges?url=YOUR_URL&clear=true`);
    console.log(`  GET /getMonitoringStatus`);
    console.log(`\n⚡ Optimizations Enabled:`);
    console.log(`  ✓ Adaptive intervals (${CONFIG.MIN_INTERVAL/60000}-${CONFIG.MAX_INTERVAL/60000} min)`);
    console.log(`  ✓ Smart first-page checking`);
    console.log(`  ✓ Parallel page scraping (${CONFIG.CONCURRENT_PAGES} concurrent)`);
    console.log(`  ✓ Circuit breaker pattern`);
    console.log(`  ✓ HTTP keep-alive connections`);
    console.log(`  ✓ Peak hours awareness (${CONFIG.PEAK_HOURS_START}:00-${CONFIG.PEAK_HOURS_END}:00)`);
    console.log(`\n🌐 Ready at http://localhost:${PORT}\n`);
});