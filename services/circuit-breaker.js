class CircuitBreaker {
    constructor(threshold = 5, timeout = 60000) {
        this.failures = 0;
        this.threshold = threshold;
        this.timeout = timeout;
        this.state = 'CLOSED';
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

module.exports = CircuitBreaker;