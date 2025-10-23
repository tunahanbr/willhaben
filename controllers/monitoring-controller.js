const monitoringService = require('../services/monitoring-service');
const sessionManager = require('../services/session-manager');
const CircuitBreaker = require('../services/circuit-breaker');
const { rebuildUrl, normalizeUrl, isPeakHours } = require('../utils/helpers');
const CONFIG = require('../config/constants');

async function startMonitoring(req, res) {
    const baseUrl = req.query.url;
    const intervalMinutes = parseInt(req.query.interval) || null;
    const webhookUrl = req.query.webhook || null;
    
    if (!baseUrl) {
        return res.status(400).json({ error: 'A "url" query parameter is required.' });
    }

    const fullUrl = rebuildUrl(req);
    
    try {
        const job = monitoringService.startMonitoring(fullUrl, webhookUrl, intervalMinutes);
        
        // Perform initial check
        await monitoringService.performSmartMonitoringCheck(job.normalizedUrl);
        
        const nextCheckTime = new Date(Date.now() + job.currentInterval).toISOString();

        res.status(200).json({
            message: 'Monitoring started successfully',
            normalizedUrl: job.normalizedUrl,
            webhookUrl: webhookUrl || 'Not configured',
            checkInterval: `${(job.currentInterval / 60000).toFixed(1)} minutes (adaptive)`,
            initialListings: job.lastSnapshot?.length || 0,
            nextCheck: nextCheckTime,
            configuration: {
                minInterval: `${CONFIG.MIN_INTERVAL / 60000} minutes`,
                maxInterval: `${CONFIG.MAX_INTERVAL / 60000} minutes`,
                adaptiveMode: 'enabled',
                peakHours: `${CONFIG.PEAK_HOURS_START}:00 - ${CONFIG.PEAK_HOURS_END}:00`,
                headlessBrowser: CONFIG.USE_HEADLESS_BROWSER,
                sessionManagement: 'enabled',
                humanBehavior: 'enabled'
            }
        });
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to start monitoring',
            details: error.message 
        });
    }
}

function stopMonitoring(req, res) {
    const baseUrl = req.query.url;
    
    if (!baseUrl) {
        return res.status(400).json({ error: 'A "url" query parameter is required.' });
    }

    const fullUrl = rebuildUrl(req);
    const normalizedUrl = normalizeUrl(fullUrl);

    const stopped = monitoringService.stopMonitoring(normalizedUrl);
    
    if (!stopped) {
        return res.status(404).json({ 
            error: 'No monitoring job found for this URL',
            normalizedUrl: normalizedUrl,
            availableJobs: monitoringService.getAllJobs().map(job => job.normalizedUrl)
        });
    }

    const job = monitoringService.getJob(normalizedUrl); // Get job before it's deleted
    
    res.status(200).json({
        message: 'Monitoring stopped successfully',
        normalizedUrl: normalizedUrl,
        totalChecks: job?.checkCount || 0,
        totalChangesDetected: job?.changes?.length || 0
    });
}

function getChanges(req, res) {
    const baseUrl = req.query.url;
    const clearAfterRead = req.query.clear === 'true';
    
    if (!baseUrl) {
        return res.status(400).json({ error: 'A "url" query parameter is required.' });
    }

    const fullUrl = rebuildUrl(req);
    const normalizedUrl = normalizeUrl(fullUrl);

    const job = monitoringService.getJob(normalizedUrl);
    if (!job) {
        return res.status(404).json({ 
            error: 'No monitoring job found for this URL',
            requestedUrl: fullUrl,
            normalizedUrl: normalizedUrl,
            availableJobs: monitoringService.getAllJobs().map(job => job.normalizedUrl)
        });
    }

    const changes = monitoringService.getChanges(normalizedUrl, clearAfterRead);
    const circuitBreaker = new CircuitBreaker(); // You might want to store circuit breakers separately

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
            circuitBreaker: circuitBreaker.getState ? circuitBreaker.getState() : null
        },
        changes: changes,
        changesCount: changes.length
    });
}

function getMonitoringStatus(req, res) {
    const activeJobs = monitoringService.getAllJobs();

    const formattedJobs = activeJobs.map(job => {
        const circuitBreaker = new CircuitBreaker(); // You might want to store circuit breakers separately
        
        return {
            normalizedUrl: job.normalizedUrl,
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
            circuitBreaker: circuitBreaker.getState ? circuitBreaker.getState() : null,
            nextCheck: new Date(Date.now() + job.currentInterval).toISOString()
        };
    });

    res.status(200).json({
        activeMonitors: activeJobs.length,
        activeSessions: sessionManager.sessions.size,
        jobs: formattedJobs,
        configuration: {
            minInterval: `${CONFIG.MIN_INTERVAL / 60000} minutes`,
            maxInterval: `${CONFIG.MAX_INTERVAL / 60000} minutes`,
            defaultInterval: `${CONFIG.DEFAULT_INTERVAL / 60000} minutes`,
            concurrentPages: CONFIG.CONCURRENT_PAGES,
            peakHours: `${CONFIG.PEAK_HOURS_START}:00 - ${CONFIG.PEAK_HOURS_END}:00`,
            isPeakHours: isPeakHours(),
            headlessBrowser: CONFIG.USE_HEADLESS_BROWSER,
            browserPoolSize: CONFIG.BROWSER_POOL_SIZE,
            sessionRotationInterval: `${CONFIG.SESSION_ROTATION_INTERVAL / 60000} minutes`,
            humanBehaviorSimulation: {
                mouseMovements: CONFIG.MOUSE_MOVEMENTS,
                randomScrolling: CONFIG.RANDOM_SCROLLING,
                delayRange: `${CONFIG.HUMAN_DELAY_MIN}-${CONFIG.HUMAN_DELAY_MAX}ms`
            }
        }
    });
}

module.exports = {
    startMonitoring,
    stopMonitoring,
    getChanges,
    getMonitoringStatus
};