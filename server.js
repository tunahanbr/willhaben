const express = require('express');
const axios = require('axios');
const cors = require('cors');
const os = require('os');

const app = express();
const PORT = 2456;

app.use(cors());

// === Monitoring State ===
const monitoringJobs = new Map(); // Normalized URL -> job data
const CHANGES_RETENTION_LIMIT = 100;

// === Webhook Configuration ===
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
                currentListingsCount: jobInfo.lastSnapshot?.length || 0
            }
        };

        await axios.post(webhookUrl, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
        });
    } catch (error) {
        console.error(`[Webhook] Failed to send to ${webhookUrl}:`, error.message);
    }
}

// === Helper: Normalize URL for consistent lookup ===
function normalizeUrl(url) {
    try {
        const urlObj = new URL(url);
        // Sort query parameters for consistent comparison
        const params = Array.from(urlObj.searchParams.entries()).sort();
        urlObj.search = '';
        params.forEach(([key, value]) => urlObj.searchParams.append(key, value));
        return urlObj.toString();
    } catch (e) {
        return url; // Return as-is if parsing fails
    }
}

// === Helper: Convert Bytes to Human-Readable ===
function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(2)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(2)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
}

// === Resource Monitoring Helpers ===
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
        },
        system: {
            platform: os.platform(),
            release: os.release(),
            arch: os.arch(),
            cpuCount: os.cpus().length,
            totalMemory: os.totalmem(),
            freeMemory: os.freemem(),
            loadAvg: os.loadavg(),
            uptime: os.uptime()
        }
    };
}

function diffUsage(start, end) {
    const cpuDiffUserMs = (end.cpu.user - start.cpu.user) / 1000;
    const cpuDiffSystemMs = (end.cpu.system - start.cpu.system) / 1000;
    const totalCpuMs = cpuDiffUserMs + cpuDiffSystemMs;

    const memDiff = {
        rss: end.memory.rss - start.memory.rss,
        heapUsed: end.memory.heapUsed - start.memory.heapUsed,
        heapTotal: end.memory.heapTotal - start.memory.heapTotal
    };

    const durationMs = Date.now() - new Date(start.timestamp).getTime();

    return {
        cpu: {
            userMs: cpuDiffUserMs,
            systemMs: cpuDiffSystemMs,
            totalMs: totalCpuMs,
            formatted: `${totalCpuMs.toFixed(2)} ms (user: ${cpuDiffUserMs.toFixed(2)} ms, system: ${cpuDiffSystemMs.toFixed(2)} ms)`
        },
        memory: {
            rss: formatBytes(end.memory.rss),
            heapUsed: formatBytes(end.memory.heapUsed),
            heapTotal: formatBytes(end.memory.heapTotal),
            diffRss: formatBytes(memDiff.rss),
            diffHeapUsed: formatBytes(memDiff.heapUsed),
            diffHeapTotal: formatBytes(memDiff.heapTotal)
        },
        duration: {
            ms: durationMs,
            seconds: (durationMs / 1000).toFixed(2),
            formatted: `${durationMs} ms (${(durationMs / 1000).toFixed(2)} s)`
        }
    };
}

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
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function randomDelay(min = 1000, max = 3000) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return delay(ms);
}

// === Scraping Functions ===
async function scrapeWillhabenPage(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const userAgent = getRandomUserAgent();
            const { data: html } = await axios.get(url, {
                headers: { 'User-Agent': userAgent },
                timeout: 15000
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
                    url: `https://www.willhaben.at${listing.contextLinkList.contextLink[0].uri}`,
                    image_urls: []
                };

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
            if (attempt < retries) await delay(Math.min(1000 * Math.pow(2, attempt), 10000));
            else throw new Error(`Failed to scrape after ${retries} attempts: ${error.message}`);
        }
    }
}

async function scrapeAllPages(baseUrl) {
    const allListings = new Map();
    let currentPage = 1;
    let totalPages = null;
    let totalListings = 0;

    while (true) {
        try {
            const pageUrl = buildUrlWithPage(baseUrl, currentPage);
            const pageData = await scrapeWillhabenPage(pageUrl);

            if (currentPage === 1) {
                totalListings = pageData.totalListings;
                const listingsPerPage = pageData.listingsPerPage;
                totalPages = Math.ceil(totalListings / listingsPerPage);
            }

            pageData.listings.forEach(listing => {
                if (!allListings.has(listing.id)) {
                    allListings.set(listing.id, listing);
                }
            });

            if (pageData.listings.length === 0 || (totalPages && currentPage >= totalPages)) break;
            currentPage++;
            await randomDelay();
        } catch (error) {
            if (allListings.size > 0) break;
            else throw error;
        }
    }

    return {
        totalListings,
        scrapedListings: allListings.size,
        pagesScraped: currentPage,
        listings: Array.from(allListings.values())
    };
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
        if (key === 'url' || key === 'interval' || key === 'clear') continue;
        const encodedKey = encodeURIComponent(key);
        const encodedValue = encodeURIComponent(req.query[key]);
        otherParams.push(`${encodedKey}=${encodedValue}`);
    }
    return baseUrl + (otherParams.length > 0 ? '&' + otherParams.join('&') : '');
}

// === Change Detection Logic ===
function detectChanges(oldListings, newListings) {
    const changes = [];
    const oldMap = new Map(oldListings.map(l => [l.id, l]));
    const newMap = new Map(newListings.map(l => [l.id, l]));

    // Detect new listings
    for (const [id, listing] of newMap) {
        if (!oldMap.has(id)) {
            const change = {
                type: 'NEW_LISTING',
                timestamp: new Date().toISOString(),
                listingId: id,
                listing: listing
            };
            changes.push(change);
        }
    }

    // Detect removed listings
    for (const [id, listing] of oldMap) {
        if (!newMap.has(id)) {
            const change = {
                type: 'REMOVED_LISTING',
                timestamp: new Date().toISOString(),
                listingId: id,
                listing: listing
            };
            changes.push(change);
        }
    }

    // Detect price changes and other updates
    for (const [id, newListing] of newMap) {
        if (oldMap.has(id)) {
            const oldListing = oldMap.get(id);
            
            // Check for price change
            if (oldListing.price !== undefined && newListing.price !== undefined && 
                oldListing.price !== newListing.price) {
                const change = {
                    type: 'PRICE_CHANGE',
                    timestamp: new Date().toISOString(),
                    listingId: id,
                    listing: newListing,
                    oldPrice: oldListing.price,
                    newPrice: newListing.price,
                    priceChange: newListing.price - oldListing.price
                };
                changes.push(change);
            }

            // Check for description change
            if (oldListing.description !== newListing.description) {
                const change = {
                    type: 'DESCRIPTION_CHANGE',
                    timestamp: new Date().toISOString(),
                    listingId: id,
                    listing: newListing,
                    oldDescription: oldListing.description,
                    newDescription: newListing.description
                };
                changes.push(change);
            }
        }
    }

    return changes;
}

// === Monitoring Functions ===
async function performMonitoringCheck(normalizedUrl) {
    const job = monitoringJobs.get(normalizedUrl);
    if (!job) return;

    try {
        const scrapeData = await scrapeAllPages(job.originalUrl);
        const newListings = scrapeData.listings;

        if (job.lastSnapshot && job.lastSnapshot.length > 0) {
            const detectedChanges = detectChanges(job.lastSnapshot, newListings);
            
            if (detectedChanges.length > 0) {
                // Add changes to the job
                job.changes.push(...detectedChanges);
                
                // Send to webhook if configured
                if (job.webhookUrl) {
                    await sendToWebhook(job.webhookUrl, detectedChanges, job);
                }
                
                // Keep only last N changes to prevent memory bloat
                if (job.changes.length > CHANGES_RETENTION_LIMIT) {
                    job.changes = job.changes.slice(-CHANGES_RETENTION_LIMIT);
                }
            }
        }

        // Update snapshot
        job.lastSnapshot = newListings;
        job.lastCheck = new Date().toISOString();
        job.checkCount = (job.checkCount || 0) + 1;
        job.lastError = null;

    } catch (error) {
        console.error(`[Monitor] Error checking ${normalizedUrl}:`, error.message);
        job.lastError = {
            message: error.message,
            timestamp: new Date().toISOString()
        };
    }
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
        const allData = await scrapeAllPages(fullUrl);
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

// === Monitoring Endpoints ===
app.get('/startMonitoring', async (req, res) => {
    const baseUrl = req.query.url;
    const intervalMinutes = parseInt(req.query.interval) || 5;
    const webhookUrl = req.query.webhook || null;
    
    if (!baseUrl) {
        return res.status(400).json({ error: 'A "url" query parameter is required.' });
    }

    const fullUrl = rebuildUrl(req);
    const normalizedUrl = normalizeUrl(fullUrl);
    const intervalMs = intervalMinutes * 60 * 1000;

    // Stop existing monitoring if any
    if (monitoringJobs.has(normalizedUrl)) {
        clearInterval(monitoringJobs.get(normalizedUrl).intervalId);
    }

    // Create new monitoring job
    const job = {
        originalUrl: fullUrl,
        normalizedUrl: normalizedUrl,
        webhookUrl: webhookUrl,
        interval: intervalMs,
        intervalMinutes: intervalMinutes,
        lastSnapshot: [],
        changes: [],
        startedAt: new Date().toISOString(),
        lastCheck: null,
        checkCount: 0,
        lastError: null,
        intervalId: null
    };

    monitoringJobs.set(normalizedUrl, job);

    // Perform initial check
    await performMonitoringCheck(normalizedUrl);

    // Set up interval
    job.intervalId = setInterval(() => {
        performMonitoringCheck(normalizedUrl);
    }, intervalMs);

    const nextCheckTime = new Date(Date.now() + intervalMs).toISOString();

    res.status(200).json({
        message: 'Monitoring started successfully',
        normalizedUrl: normalizedUrl,
        webhookUrl: webhookUrl || 'Not configured',
        checkInterval: `${intervalMinutes} minutes`,
        initialListings: job.lastSnapshot?.length || 0,
        nextCheck: nextCheckTime
    });
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
            intervalMinutes: job.intervalMinutes,
            currentListingsCount: job.lastSnapshot?.length || 0,
            lastError: job.lastError,
            webhookUrl: job.webhookUrl || 'Not configured'
        },
        changes: changes,
        changesCount: changes.length
    });
});

app.get('/getMonitoringStatus', (req, res) => {
    const activeJobs = [];

    for (const [url, job] of monitoringJobs) {
        activeJobs.push({
            normalizedUrl: url,
            originalUrl: job.originalUrl,
            webhookUrl: job.webhookUrl || 'Not configured',
            startedAt: job.startedAt,
            lastCheck: job.lastCheck,
            checkCount: job.checkCount,
            intervalMinutes: job.intervalMinutes,
            currentListingsCount: job.lastSnapshot?.length || 0,
            pendingChanges: job.changes.length,
            lastError: job.lastError
        });
    }

    res.status(200).json({
        activeMonitors: activeJobs.length,
        jobs: activeJobs
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
    console.log(`Scraper API running at http://localhost:${PORT}`);
    console.log(`\nEndpoints:`);
    console.log(`  Single page:        GET /getListings?url=YOUR_WILLHABEN_URL`);
    console.log(`  All pages:          GET /getAllListings?url=YOUR_WILLHABEN_URL`);
    console.log(`\nMonitoring endpoints:`);
    console.log(`  Start monitoring:   GET /startMonitoring?url=YOUR_WILLHABEN_URL&interval=5&webhook=YOUR_WEBHOOK_URL`);
    console.log(`  Stop monitoring:    GET /stopMonitoring?url=YOUR_WILLHABEN_URL`);
    console.log(`  Get changes:        GET /getChanges?url=YOUR_WILLHABEN_URL&clear=true`);
    console.log(`  Monitoring status:  GET /getMonitoringStatus`);
    console.log(`\nNote: interval parameter is in minutes (default: 5)`);
    console.log(`      webhook parameter is optional (your n8n webhook URL)`);
});