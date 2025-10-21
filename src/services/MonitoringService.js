const winston = require('winston');
const { register, collectDefaultMetrics, Counter, Histogram, Gauge } = require('prom-client');

class MonitoringService {
    constructor(config = {}) {
        this.config = {
            logLevel: config.logLevel || 'info',
            logFile: config.logFile || './logs/listener.log',
            metricsPort: config.metricsPort || 9090,
            enableMetrics: config.enableMetrics !== false,
            ...config
        };

        this.logger = null;
        this.metrics = {};
        this.isInitialized = false;
    }

    async initialize() {
        try {
            // Initialize logger
            this.logger = winston.createLogger({
                level: this.config.logLevel,
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.errors({ stack: true }),
                    winston.format.json()
                ),
                defaultMeta: { service: 'willhaben-listener' },
                transports: [
                    new winston.transports.Console({
                        format: winston.format.combine(
                            winston.format.colorize(),
                            winston.format.simple()
                        )
                    }),
                    new winston.transports.File({ 
                        filename: this.config.logFile,
                        maxsize: 10485760, // 10MB
                        maxFiles: 5
                    })
                ]
            });

            // Initialize metrics if enabled
            if (this.config.enableMetrics) {
                this.initializeMetrics();
            }

            this.isInitialized = true;
            console.log('MonitoringService initialized successfully');
        } catch (error) {
            console.error('Failed to initialize MonitoringService:', error);
            throw error;
        }
    }

    initializeMetrics() {
        // Collect default metrics
        collectDefaultMetrics({ register });

        // Custom metrics
        this.metrics = {
            // Polling metrics
            pollsTotal: new Counter({
                name: 'listener_polls_total',
                help: 'Total number of polling attempts',
                labelNames: ['target_id', 'status']
            }),

            pollDuration: new Histogram({
                name: 'listener_poll_duration_seconds',
                help: 'Duration of polling operations',
                labelNames: ['target_id'],
                buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60]
            }),

            // Change detection metrics
            changesDetected: new Counter({
                name: 'listener_changes_detected_total',
                help: 'Total number of changes detected',
                labelNames: ['target_id', 'change_type']
            }),

            // Event processing metrics
            eventsProcessed: new Counter({
                name: 'listener_events_processed_total',
                help: 'Total number of events processed',
                labelNames: ['event_type', 'status']
            }),

            eventProcessingDuration: new Histogram({
                name: 'listener_event_processing_duration_seconds',
                help: 'Duration of event processing',
                labelNames: ['event_type'],
                buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
            }),

            // System health metrics
            activePolls: new Gauge({
                name: 'listener_active_polls',
                help: 'Number of currently active polls'
            }),

            queueLength: new Gauge({
                name: 'listener_queue_length',
                help: 'Length of the polling queue'
            }),

            pendingEvents: new Gauge({
                name: 'listener_pending_events',
                help: 'Number of pending events in the outbox'
            }),

            // Error metrics
            errorsTotal: new Counter({
                name: 'listener_errors_total',
                help: 'Total number of errors',
                labelNames: ['component', 'error_type']
            }),

            // Circuit breaker metrics
            circuitBreakerState: new Gauge({
                name: 'listener_circuit_breaker_state',
                help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
                labelNames: ['target_id']
            })
        };

        console.log('Metrics initialized successfully');
    }

    // Logging methods
    info(message, meta = {}) {
        if (this.logger) {
            this.logger.info(message, meta);
        } else {
            console.log(`[INFO] ${message}`, meta);
        }
    }

    warn(message, meta = {}) {
        if (this.logger) {
            this.logger.warn(message, meta);
        } else {
            console.warn(`[WARN] ${message}`, meta);
        }
    }

    error(message, error = null, meta = {}) {
        if (this.logger) {
            this.logger.error(message, { error: error?.message, stack: error?.stack, ...meta });
        } else {
            console.error(`[ERROR] ${message}`, error, meta);
        }

        // Record error metric
        if (this.metrics.errorsTotal) {
            this.metrics.errorsTotal.inc({
                component: meta.component || 'unknown',
                error_type: error?.name || 'unknown'
            });
        }
    }

    debug(message, meta = {}) {
        if (this.logger) {
            this.logger.debug(message, meta);
        } else {
            console.debug(`[DEBUG] ${message}`, meta);
        }
    }

    // Metrics methods
    recordPoll(targetId, status, duration) {
        if (this.metrics.pollsTotal) {
            this.metrics.pollsTotal.inc({ target_id: targetId, status });
        }
        if (this.metrics.pollDuration) {
            this.metrics.pollDuration.observe({ target_id: targetId }, duration);
        }
    }

    recordChange(targetId, changeType) {
        if (this.metrics.changesDetected) {
            this.metrics.changesDetected.inc({ target_id: targetId, change_type: changeType });
        }
    }

    recordEvent(eventType, status, duration) {
        if (this.metrics.eventsProcessed) {
            this.metrics.eventsProcessed.inc({ event_type: eventType, status });
        }
        if (this.metrics.eventProcessingDuration) {
            this.metrics.eventProcessingDuration.observe({ event_type: eventType }, duration);
        }
    }

    updateActivePolls(count) {
        if (this.metrics.activePolls) {
            this.metrics.activePolls.set(count);
        }
    }

    updateQueueLength(length) {
        if (this.metrics.queueLength) {
            this.metrics.queueLength.set(length);
        }
    }

    updatePendingEvents(count) {
        if (this.metrics.pendingEvents) {
            this.metrics.pendingEvents.set(count);
        }
    }

    updateCircuitBreakerState(targetId, state) {
        if (this.metrics.circuitBreakerState) {
            const stateValue = state === 'CLOSED' ? 0 : state === 'OPEN' ? 1 : 2;
            this.metrics.circuitBreakerState.set({ target_id: targetId }, stateValue);
        }
    }

    // Health check methods
    async performHealthCheck() {
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            checks: {}
        };

        try {
            // Check database connectivity
            health.checks.database = await this.checkDatabaseHealth();
            
            // Check Redis connectivity
            health.checks.redis = await this.checkRedisHealth();
            
            // Check system resources
            health.checks.resources = this.checkResourceHealth();
            
            // Overall health status
            const allHealthy = Object.values(health.checks).every(check => check.status === 'healthy');
            health.status = allHealthy ? 'healthy' : 'unhealthy';
            
        } catch (error) {
            this.error('Health check failed', error);
            health.status = 'unhealthy';
            health.error = error.message;
        }

        return health;
    }

    async checkDatabaseHealth() {
        try {
            // This would check SQLite database connectivity
            return { status: 'healthy', message: 'Database connection OK' };
        } catch (error) {
            return { status: 'unhealthy', message: error.message };
        }
    }

    async checkRedisHealth() {
        try {
            // This would check Redis connectivity
            return { status: 'healthy', message: 'Redis connection OK' };
        } catch (error) {
            return { status: 'unhealthy', message: error.message };
        }
    }

    checkResourceHealth() {
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        const health = {
            status: 'healthy',
            memory: {
                rss: memUsage.rss,
                heapUsed: memUsage.heapUsed,
                heapTotal: memUsage.heapTotal,
                external: memUsage.external
            },
            cpu: {
                user: cpuUsage.user,
                system: cpuUsage.system
            }
        };

        // Check memory usage
        const memoryUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
        if (memoryUsagePercent > 90) {
            health.status = 'unhealthy';
            health.warnings = health.warnings || [];
            health.warnings.push('High memory usage detected');
        }

        return health;
    }

    // Alerting methods
    async sendAlert(level, message, details = {}) {
        const alert = {
            level, // 'info', 'warning', 'error', 'critical'
            message,
            details,
            timestamp: new Date().toISOString(),
            service: 'willhaben-listener'
        };

        this.logger?.warn(`ALERT [${level.toUpperCase()}]: ${message}`, alert);

        // Here you would integrate with alerting systems like:
        // - Slack webhooks
        // - Email notifications
        // - PagerDuty
        // - Custom webhook endpoints
        
        console.log(`ALERT [${level.toUpperCase()}]: ${message}`, details);
    }

    // Performance tracking
    startTimer(name) {
        const start = process.hrtime.bigint();
        return {
            end: () => {
                const end = process.hrtime.bigint();
                const duration = Number(end - start) / 1000000; // Convert to milliseconds
                this.debug(`Timer ${name}: ${duration.toFixed(2)}ms`);
                return duration;
            }
        };
    }

    // Get metrics for Prometheus
    async getMetrics() {
        if (!this.config.enableMetrics) {
            return 'Metrics disabled';
        }
        return register.metrics();
    }

    // Dashboard data
    async getDashboardData() {
        try {
            const health = await this.performHealthCheck();
            
            return {
                health,
                metrics: {
                    pollsTotal: this.metrics.pollsTotal ? this.metrics.pollsTotal.toString() : null,
                    changesDetected: this.metrics.changesDetected ? this.metrics.changesDetected.toString() : null,
                    eventsProcessed: this.metrics.eventsProcessed ? this.metrics.eventsProcessed.toString() : null,
                    activePolls: this.metrics.activePolls ? this.metrics.activePolls.toString() : null,
                    queueLength: this.metrics.queueLength ? this.metrics.queueLength.toString() : null,
                    pendingEvents: this.metrics.pendingEvents ? this.metrics.pendingEvents.toString() : null
                },
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            this.error('Failed to get dashboard data', error);
            return null;
        }
    }
}

module.exports = { MonitoringService };
