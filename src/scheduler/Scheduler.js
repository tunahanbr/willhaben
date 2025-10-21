const cron = require('node-cron');
const { PollingTarget } = require('../models/PollingTarget');
const { StateStore } = require('../stores/StateStore');
const { DiffEngine } = require('../engines/DiffEngine');
const ScraperWorker = require('../workers/ScraperWorker');

class Scheduler {
    constructor(config = {}) {
        this.config = {
            maxConcurrentPolls: config.maxConcurrentPolls || 5,
            pollIntervalMs: config.pollIntervalMs || 10000, // 10 seconds
            reconciliationInterval: config.reconciliationInterval || '0 2 * * *', // Daily at 2 AM
            healthCheckInterval: config.healthCheckInterval || '*/5 * * * *', // Every 5 minutes
            ...config
        };
        
        this.stateStore = new StateStore(config.stateStore);
        this.diffEngine = new DiffEngine(config.diffEngine);
        this.scraperWorker = new ScraperWorker(config.scraper);
        
        this.isRunning = false;
        this.activePolls = new Map();
        this.pollingQueue = [];
        this.rateLimiters = new Map();
        
        // Metrics
        this.metrics = {
            totalPolls: 0,
            successfulPolls: 0,
            failedPolls: 0,
            changesDetected: 0,
            eventsEmitted: 0,
            lastPollAt: null,
            averagePollDuration: 0
        };
    }

    async initialize() {
        try {
            await this.stateStore.connect();
            console.log('Scheduler initialized successfully');
        } catch (error) {
            console.error('Failed to initialize scheduler:', error);
            throw error;
        }
    }

    async start() {
        if (this.isRunning) {
            console.warn('Scheduler is already running');
            return;
        }

        this.isRunning = true;
        console.log('Starting scheduler...');

        // Start main polling loop
        this.pollingInterval = setInterval(() => {
            this.processPollingQueue();
        }, this.config.pollIntervalMs);

        // Start reconciliation job
        this.reconciliationJob = cron.schedule(this.config.reconciliationInterval, () => {
            this.runReconciliation();
        });

        // Start health check job
        this.healthCheckJob = cron.schedule(this.config.healthCheckInterval, () => {
            this.runHealthCheck();
        });

        console.log('Scheduler started successfully');
    }

    async stop() {
        if (!this.isRunning) {
            console.warn('Scheduler is not running');
            return;
        }

        this.isRunning = false;
        console.log('Stopping scheduler...');

        // Clear intervals
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }

        if (this.reconciliationJob) {
            this.reconciliationJob.destroy();
        }

        if (this.healthCheckJob) {
            this.healthCheckJob.destroy();
        }

        // Wait for active polls to complete
        await this.waitForActivePolls();

        // Disconnect from state store
        await this.stateStore.disconnect();

        console.log('Scheduler stopped successfully');
    }

    async addPollingTarget(targetConfig) {
        try {
            const target = new PollingTarget(targetConfig);
            await this.stateStore.savePollingTarget(target);
            
            console.log(`Added polling target: ${target.id} (${target.url})`);
            return target;
        } catch (error) {
            console.error('Failed to add polling target:', error);
            throw error;
        }
    }

    async removePollingTarget(targetId) {
        try {
            // Remove from active polls if running
            if (this.activePolls.has(targetId)) {
                this.activePolls.delete(targetId);
            }

            // Remove from polling queue
            this.pollingQueue = this.pollingQueue.filter(t => t.id !== targetId);

            // Remove from state store
            await this.stateStore.deletePollingTarget(targetId);
            
            console.log(`Removed polling target: ${targetId}`);
            return true;
        } catch (error) {
            console.error('Failed to remove polling target:', error);
            return false;
        }
    }

    async updatePollingTarget(targetId, updates) {
        try {
            const target = await this.stateStore.getPollingTarget(targetId);
            if (!target) {
                throw new Error(`Polling target not found: ${targetId}`);
            }

            // Update target properties
            Object.keys(updates).forEach(key => {
                if (target[key] !== undefined) {
                    target[key] = updates[key];
                }
            });

            target.updatedAt = new Date();
            await this.stateStore.savePollingTarget(target);
            
            console.log(`Updated polling target: ${targetId}`);
            return target;
        } catch (error) {
            console.error('Failed to update polling target:', error);
            throw error;
        }
    }

    async processPollingQueue() {
        if (!this.isRunning) return;

        try {
            // Get all polling targets
            const targets = await this.stateStore.getAllPollingTargets();
            
            // Filter targets that should be polled
            const targetsToPoll = targets.filter(target => 
                target.enabled && 
                target.shouldPoll() && 
                !this.activePolls.has(target.id) &&
                this.canPollTarget(target)
            );

            // Add to queue
            targetsToPoll.forEach(target => {
                if (!this.pollingQueue.find(t => t.id === target.id)) {
                    this.pollingQueue.push(target);
                }
            });

            // Process queue
            while (this.pollingQueue.length > 0 && 
                   this.activePolls.size < this.config.maxConcurrentPolls) {
                const target = this.pollingQueue.shift();
                this.pollTarget(target);
            }

        } catch (error) {
            console.error('Error processing polling queue:', error);
        }
    }

    async pollTarget(target) {
        if (this.activePolls.has(target.id)) {
            return; // Already polling this target
        }

        this.activePolls.set(target.id, {
            startTime: Date.now(),
            target
        });

        try {
            console.log(`Starting poll for target: ${target.id}`);
            
            // Check rate limits
            if (!this.checkRateLimit(target)) {
                console.log(`Rate limit exceeded for target: ${target.id}`);
                target.recordFailure();
                await this.stateStore.savePollingTarget(target);
                return;
            }

            // Scrape the target
            const scrapedData = await this.scraperWorker.scrapeTarget(target);
            
            if (!scrapedData || !scrapedData.listings) {
                throw new Error('No listings found in scraped data');
            }

            // Get existing canonical listings for this source
            const canonicalListings = await this.stateStore.getAllListings(target.url);
            
            // Detect changes
            const changes = this.diffEngine.detectChanges(
                scrapedData.listings,
                canonicalListings,
                target.url
            );

            // Process changes
            await this.processChanges(changes, scrapedData.listings, target);

            // Update target success metrics
            target.recordSuccess();
            target.recordChange(changes.length > 0 ? 'CHANGE' : 'NO_CHANGE');
            await this.stateStore.savePollingTarget(target);

            // Update metrics
            this.updateMetrics(true, changes.length);

            console.log(`Completed poll for target: ${target.id} (${changes.length} changes detected)`);

        } catch (error) {
            console.error(`Poll failed for target ${target.id}:`, error);
            
            // Update target failure metrics
            target.recordFailure();
            await this.stateStore.savePollingTarget(target);
            
            // Update metrics
            this.updateMetrics(false, 0);
        } finally {
            this.activePolls.delete(target.id);
        }
    }

    async processChanges(changes, scrapedListings, target) {
        const scrapedMap = new Map(scrapedListings.map(listing => [listing.id, listing]));

        for (const change of changes) {
            try {
                // Save event to outbox
                await this.stateStore.saveEvent(change);

                // Update canonical state
                if (change.eventType === 'CREATED') {
                    const scrapedListing = scrapedMap.get(change.listingId);
                    const canonicalListing = this.diffEngine.createCanonicalListing(
                        scrapedListing, 
                        target.url
                    );
                    await this.stateStore.saveListing(canonicalListing);
                } else if (change.eventType === 'UPDATED') {
                    const canonicalListing = await this.stateStore.getListing(change.listingId);
                    if (canonicalListing) {
                        const scrapedListing = scrapedMap.get(change.listingId);
                        const updatedListing = this.diffEngine.updateCanonicalListing(
                            canonicalListing, 
                            scrapedListing
                        );
                        await this.stateStore.saveListing(updatedListing);
                    }
                } else if (change.eventType === 'REMOVED') {
                    // Mark as removed but don't delete immediately
                    const canonicalListing = await this.stateStore.getListing(change.listingId);
                    if (canonicalListing) {
                        canonicalListing.status = 'REMOVED';
                        canonicalListing.lastSeenAt = new Date();
                        await this.stateStore.saveListing(canonicalListing);
                    }
                }

                this.metrics.eventsEmitted++;
            } catch (error) {
                console.error(`Failed to process change event ${change.eventId}:`, error);
            }
        }
    }

    canPollTarget(target) {
        // Check circuit breaker
        if (target.circuitBreakerState === 'OPEN') {
            return false;
        }

        // Check if target is in grace period after failure
        if (target.consecutiveFailures > 0) {
            const lastPoll = target.lastPolledAt ? new Date(target.lastPolledAt) : new Date(0);
            const gracePeriodMs = Math.min(1000 * Math.pow(2, target.consecutiveFailures), 300000); // Max 5 minutes
            return (Date.now() - lastPoll.getTime()) >= gracePeriodMs;
        }

        return true;
    }

    checkRateLimit(target) {
        const domain = target.domain;
        const now = Date.now();
        
        if (!this.rateLimiters.has(domain)) {
            this.rateLimiters.set(domain, {
                requests: [],
                lastReset: now
            });
        }

        const limiter = this.rateLimiters.get(domain);
        const policy = target.rateLimitPolicy;

        // Clean old requests
        limiter.requests = limiter.requests.filter(
            timestamp => (now - timestamp) < 60000 // Last minute
        );

        // Check limits
        if (limiter.requests.length >= policy.requestsPerMinute) {
            return false;
        }

        // Add current request
        limiter.requests.push(now);
        return true;
    }

    async runReconciliation() {
        console.log('Starting reconciliation job...');
        
        try {
            const targets = await this.stateStore.getAllPollingTargets();
            
            for (const target of targets) {
                try {
                    console.log(`Running reconciliation for target: ${target.id}`);
                    
                    // Force a full rescan
                    const scrapedData = await this.scraperWorker.scrapeTarget(target, true);
                    
                    if (scrapedData && scrapedData.listings) {
                        // Get all canonical listings for this source
                        const canonicalListings = await this.stateStore.getAllListings(target.url);
                        
                        // Detect any inconsistencies
                        const changes = this.diffEngine.detectChanges(
                            scrapedData.listings,
                            canonicalListings,
                            target.url
                        );

                        if (changes.length > 0) {
                            console.log(`Reconciliation found ${changes.length} inconsistencies for target: ${target.id}`);
                            await this.processChanges(changes, scrapedData.listings, target);
                        }
                    }
                    
                    // Reset circuit breaker if it was open
                    if (target.circuitBreakerState === 'OPEN') {
                        target.circuitBreakerState = 'HALF_OPEN';
                        await this.stateStore.savePollingTarget(target);
                    }
                    
                } catch (error) {
                    console.error(`Reconciliation failed for target ${target.id}:`, error);
                }
            }
            
            console.log('Reconciliation job completed');
        } catch (error) {
            console.error('Reconciliation job failed:', error);
        }
    }

    async runHealthCheck() {
        const health = {
            isRunning: this.isRunning,
            activePolls: this.activePolls.size,
            queueLength: this.pollingQueue.length,
            metrics: this.metrics,
            timestamp: new Date()
        };

        // Check for stuck polls
        const now = Date.now();
        for (const [targetId, pollInfo] of this.activePolls) {
            const duration = now - pollInfo.startTime;
            if (duration > 300000) { // 5 minutes
                console.warn(`Stuck poll detected for target ${targetId} (${duration}ms)`);
                this.activePolls.delete(targetId);
            }
        }

        console.log('Health check:', JSON.stringify(health, null, 2));
        return health;
    }

    async waitForActivePolls() {
        const maxWaitTime = 30000; // 30 seconds
        const startTime = Date.now();
        
        while (this.activePolls.size > 0 && (Date.now() - startTime) < maxWaitTime) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        if (this.activePolls.size > 0) {
            console.warn(`Force stopping ${this.activePolls.size} active polls`);
            this.activePolls.clear();
        }
    }

    updateMetrics(success, changesDetected) {
        this.metrics.totalPolls++;
        if (success) {
            this.metrics.successfulPolls++;
        } else {
            this.metrics.failedPolls++;
        }
        this.metrics.changesDetected += changesDetected;
        this.metrics.lastPollAt = new Date();
    }

    getMetrics() {
        return {
            ...this.metrics,
            successRate: this.metrics.totalPolls > 0 ? 
                (this.metrics.successfulPolls / this.metrics.totalPolls) : 0,
            activePolls: this.activePolls.size,
            queueLength: this.pollingQueue.length
        };
    }

    async getStatus() {
        const targets = await this.stateStore.getAllPollingTargets();
        const pendingEvents = await this.stateStore.getPendingEvents(10);
        
        return {
            isRunning: this.isRunning,
            targets: {
                total: targets.length,
                enabled: targets.filter(t => t.enabled).length,
                active: targets.filter(t => t.shouldPoll()).length
            },
            activePolls: Array.from(this.activePolls.keys()),
            queueLength: this.pollingQueue.length,
            pendingEvents: pendingEvents.length,
            metrics: this.getMetrics()
        };
    }
}

module.exports = { Scheduler };
