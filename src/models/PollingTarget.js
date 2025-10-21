class PollingTarget {
    constructor(data) {
        this.id = data.id;
        this.url = data.url;
        this.domain = new URL(data.url).hostname;
        
        // Polling configuration
        this.baseInterval = data.baseInterval || 300; // 5 minutes default
        this.minInterval = data.minInterval || 60;    // 1 minute minimum
        this.maxInterval = data.maxInterval || 3600;  // 1 hour maximum
        this.adaptivePolicy = data.adaptivePolicy || {
            changeThreshold: 5,      // Changes per hour to trigger adjustment
            stabilityBonus: 0.5,     // Reduce polling for stable targets
            activityBoost: 2.0,      // Increase polling for active targets
            learningWindow: 24       // Hours of history to consider
        };
        
        // Rate limiting
        this.rateLimitPolicy = data.rateLimitPolicy || {
            requestsPerMinute: 10,
            requestsPerHour: 100,
            burstLimit: 5
        };
        
        // State tracking
        this.lastPolledAt = data.lastPolledAt || null;
        this.consecutiveFailures = data.consecutiveFailures || 0;
        this.circuitBreakerState = data.circuitBreakerState || 'CLOSED';
        this.lastSuccessAt = data.lastSuccessAt || null;
        
        // Change tracking
        this.changeHistory = data.changeHistory || [];
        this.currentChangeRate = data.currentChangeRate || 0;
        
        // Configuration
        this.trackedFields = data.trackedFields || ['title', 'price', 'condition', 'location'];
        this.gracePeriod = data.gracePeriod || 300; // 5 minutes before declaring removal
        this.enabled = data.enabled !== false;
        
        // Metadata
        this.createdAt = data.createdAt || new Date();
        this.updatedAt = data.updatedAt || new Date();
        this.meta = data.meta || {};
    }

    updateChangeRate() {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        
        // Count changes in the last hour
        const recentChanges = this.changeHistory.filter(change => 
            new Date(change.timestamp) > oneHourAgo
        );
        
        this.currentChangeRate = recentChanges.length;
        this.updatedAt = new Date();
    }

    calculateAdaptiveInterval() {
        this.updateChangeRate();
        
        let interval = this.baseInterval;
        
        // Adjust based on change rate
        if (this.currentChangeRate > this.adaptivePolicy.changeThreshold) {
            // High activity - reduce interval
            interval = Math.max(
                this.minInterval,
                interval / this.adaptivePolicy.activityBoost
            );
        } else if (this.currentChangeRate === 0 && this.consecutiveFailures === 0) {
            // Stable - increase interval
            interval = Math.min(
                this.maxInterval,
                interval * this.adaptivePolicy.stabilityBonus
            );
        }
        
        // Circuit breaker adjustments
        if (this.circuitBreakerState === 'OPEN') {
            interval = Math.min(interval * 2, this.maxInterval);
        }
        
        return Math.round(interval);
    }

    recordChange(changeType) {
        this.changeHistory.push({
            timestamp: new Date(),
            type: changeType
        });
        
        // Keep only last 24 hours of history
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        this.changeHistory = this.changeHistory.filter(change => 
            new Date(change.timestamp) > oneDayAgo
        );
        
        this.updateChangeRate();
    }

    recordSuccess() {
        this.consecutiveFailures = 0;
        this.lastSuccessAt = new Date();
        this.lastPolledAt = new Date();
        
        if (this.circuitBreakerState === 'HALF_OPEN') {
            this.circuitBreakerState = 'CLOSED';
        }
        
        this.updatedAt = new Date();
    }

    recordFailure() {
        this.consecutiveFailures++;
        this.lastPolledAt = new Date();
        
        // Circuit breaker logic
        if (this.consecutiveFailures >= 5) {
            this.circuitBreakerState = 'OPEN';
        }
        
        this.updatedAt = new Date();
    }

    shouldPoll() {
        if (!this.enabled) return false;
        
        const now = new Date();
        const lastPoll = this.lastPolledAt ? new Date(this.lastPolledAt) : new Date(0);
        const interval = this.calculateAdaptiveInterval();
        
        return (now.getTime() - lastPoll.getTime()) >= (interval * 1000);
    }

    toJSON() {
        return {
            id: this.id,
            url: this.url,
            domain: this.domain,
            baseInterval: this.baseInterval,
            minInterval: this.minInterval,
            maxInterval: this.maxInterval,
            adaptivePolicy: this.adaptivePolicy,
            rateLimitPolicy: this.rateLimitPolicy,
            lastPolledAt: this.lastPolledAt,
            consecutiveFailures: this.consecutiveFailures,
            circuitBreakerState: this.circuitBreakerState,
            lastSuccessAt: this.lastSuccessAt,
            changeHistory: this.changeHistory,
            currentChangeRate: this.currentChangeRate,
            trackedFields: this.trackedFields,
            gracePeriod: this.gracePeriod,
            enabled: this.enabled,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            meta: this.meta
        };
    }

    static fromJSON(data) {
        return new PollingTarget(data);
    }
}

module.exports = {
    PollingTarget
};
