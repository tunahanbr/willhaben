const CircuitBreaker = require('./circuit-breaker');
const { scrapeWillhabenPage, scrapeAllPagesParallel } = require('./scraping-service');
const { sendToWebhook } = require('./webhook-service');
const { normalizeUrl, setsEqual, isPeakHours } = require('../utils/helpers');
const { buildUrlWithPage } = require('../utils/helpers');
const CONFIG = require('../config/constants');

const monitoringJobs = new Map();
const circuitBreakers = new Map();

// === Change Detection ===
function detectChanges(oldListings, newListings) {
    const changes = [];
    const oldMap = new Map(oldListings.map(l => [l.id, l]));
    const newMap = new Map(newListings.map(l => [l.id, l]));

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

// === Adaptive Interval Logic ===
function calculateNextInterval(job) {
    const now = Date.now();
    const recentChanges = job.changes.filter(c => 
        now - new Date(c.timestamp).getTime() < CONFIG.ACTIVITY_WINDOW
    ).length;
    
    let interval;
    if (recentChanges > 5) {
        interval = CONFIG.ACTIVE_INTERVAL;
    } else if (recentChanges > 0) {
        interval = CONFIG.DEFAULT_INTERVAL;
    } else {
        interval = CONFIG.QUIET_INTERVAL;
    }
    
    if (!isPeakHours()) {
        interval = Math.min(interval * 1.5, CONFIG.MAX_INTERVAL);
    }
    
    if (job.consecutiveErrors > 0) {
        const backoffMultiplier = Math.pow(2, Math.min(job.consecutiveErrors, 4));
        interval = Math.min(interval * backoffMultiplier, CONFIG.MAX_INTERVAL);
    }
    
    return Math.max(interval, CONFIG.MIN_INTERVAL);
}

// === Smart Monitoring Check ===
async function performSmartMonitoringCheck(normalizedUrl) {
    const job = monitoringJobs.get(normalizedUrl);
    if (!job) return;

    const breaker = circuitBreakers.get(normalizedUrl);
    
    try {
        await breaker.execute(async () => {
            // Quick check: only first page
            const firstPageData = await scrapeWillhabenPage(job.originalUrl, job.originalUrl);
            const firstPageIds = new Set(firstPageData.listings.map(l => l.id));
            
            let needsFullScrape = false;
            
            if (job.lastSnapshot && job.lastSnapshot.length > 0) {
                const pageSize = firstPageData.listingsPerPage;
                const oldFirstPageIds = new Set(
                    job.lastSnapshot.slice(0, pageSize).map(l => l.id)
                );
                
                needsFullScrape = !setsEqual(firstPageIds, oldFirstPageIds);
            } else {
                needsFullScrape = true;
            }
            
            let newListings;
            let scrapingStats;
            
            if (needsFullScrape) {
                console.log(`[Monitor] Changes detected on first page for ${normalizedUrl}, doing full scrape...`);
                const fullData = await scrapeAllPagesParallel(job.originalUrl, job.originalUrl, false);
                newListings = fullData.listings;
                scrapingStats = {
                    mode: 'full',
                    pagesScraped: fullData.pagesScraped,
                    listingsFound: fullData.scrapedListings,
                    sessionInfo: fullData.sessionInfo
                };
            } else {
                newListings = job.lastSnapshot;
                scrapingStats = {
                    mode: 'fast',
                    pagesScraped: 1,
                    listingsFound: firstPageData.listings.length,
                    sessionInfo: firstPageData.sessionInfo
                };
                console.log(`[Monitor] No changes on first page for ${normalizedUrl}, skipping full scrape`);
            }

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

            job.lastSnapshot = newListings;
            job.lastCheck = new Date().toISOString();
            job.checkCount = (job.checkCount || 0) + 1;
            job.consecutiveErrors = 0;
            job.lastError = null;
            job.lastScrapingStats = scrapingStats;
            
            const nextInterval = calculateNextInterval(job);
            job.currentInterval = nextInterval;
            
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
        
        const nextInterval = calculateNextInterval(job);
        job.currentInterval = nextInterval;
        rescheduleJob(normalizedUrl, nextInterval);
    }
}

function rescheduleJob(normalizedUrl, newInterval) {
    const job = monitoringJobs.get(normalizedUrl);
    if (!job) return;
    
    if (job.intervalId) {
        clearInterval(job.intervalId);
    }
    
    job.intervalId = setInterval(() => {
        performSmartMonitoringCheck(normalizedUrl);
    }, newInterval);
}

// === Public Methods ===
function startMonitoring(fullUrl, webhookUrl = null, intervalMinutes = null) {
    const normalizedUrl = normalizeUrl(fullUrl);

    if (monitoringJobs.has(normalizedUrl)) {
        const oldJob = monitoringJobs.get(normalizedUrl);
        clearInterval(oldJob.intervalId);
    }

    if (!circuitBreakers.has(normalizedUrl)) {
        circuitBreakers.set(normalizedUrl, new CircuitBreaker(5, 60000));
    }

    const initialInterval = intervalMinutes 
        ? Math.max(intervalMinutes * 60 * 1000, CONFIG.MIN_INTERVAL)
        : CONFIG.DEFAULT_INTERVAL;

    const job = {
        title: null,  // Will be set by controller
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
    return job;
}

function stopMonitoring(normalizedUrl) {
    if (!monitoringJobs.has(normalizedUrl)) {
        return false;
    }

    const job = monitoringJobs.get(normalizedUrl);
    clearInterval(job.intervalId);
    monitoringJobs.delete(normalizedUrl);
    circuitBreakers.delete(normalizedUrl);
    return true;
}

function getJob(normalizedUrl) {
    return monitoringJobs.get(normalizedUrl);
}

function getAllJobs() {
    return Array.from(monitoringJobs.entries()).map(([url, job]) => ({
        normalizedUrl: url,
        ...job
    }));
}

function getChanges(normalizedUrl, clearAfterRead = false) {
    const job = monitoringJobs.get(normalizedUrl);
    if (!job) return null;

    const changes = [...job.changes];
    if (clearAfterRead) {
        job.changes = [];
    }
    return changes;
}

function cleanupAllJobs() {
    for (const [url, job] of monitoringJobs) {
        clearInterval(job.intervalId);
    }
    monitoringJobs.clear();
    circuitBreakers.clear();
}

module.exports = {
    startMonitoring,
    stopMonitoring,
    getJob,
    getAllJobs,
    getChanges,
    performSmartMonitoringCheck,
    cleanupAllJobs
};