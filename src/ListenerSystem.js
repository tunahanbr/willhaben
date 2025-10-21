const { Scheduler } = require('./scheduler/Scheduler');
const { NotificationService } = require('./services/NotificationService');
const { MonitoringService } = require('./services/MonitoringService');
const { StateStore } = require('./stores/StateStore');
const { AdminAPI } = require('./api/AdminAPI');

class ListenerSystem {
    constructor(config = {}) {
        this.config = {
            stateStore: {
                redis: {
                    host: config.redis?.host || 'localhost',
                    port: config.redis?.port || 6379,
                    password: config.redis?.password || null,
                    db: config.redis?.db || 0
                },
                sqlite: {
                    path: config.sqlite?.path || './data/listener.db'
                }
            },
            scheduler: {
                maxConcurrentPolls: config.maxConcurrentPolls || 5,
                pollIntervalMs: config.pollIntervalMs || 10000,
                reconciliationInterval: config.reconciliationInterval || '0 2 * * *',
                healthCheckInterval: config.healthCheckInterval || '*/5 * * * *'
            },
            notification: {
                maxRetries: config.maxRetries || 3,
                retryDelay: config.retryDelay || 1000,
                batchSize: config.batchSize || 10,
                processingInterval: config.processingInterval || 5000,
                webhookSecret: config.webhookSecret || null
            },
            monitoring: {
                logLevel: config.logLevel || 'info',
                logFile: config.logFile || './logs/listener.log',
                metricsPort: config.metricsPort || 9090,
                enableMetrics: config.enableMetrics !== false
            },
            admin: {
                port: config.adminPort || 3001,
                basePath: config.adminBasePath || '/api/admin'
            },
            ...config
        };

        this.stateStore = null;
        this.scheduler = null;
        this.notificationService = null;
        this.monitoringService = null;
        this.adminAPI = null;
        
        this.isInitialized = false;
        this.isRunning = false;
    }

    async initialize() {
        try {
            console.log('Initializing ListenerSystem...');

            // Initialize monitoring first
            this.monitoringService = new MonitoringService(this.config.monitoring);
            await this.monitoringService.initialize();

            // Initialize state store
            this.stateStore = new StateStore(this.config.stateStore);
            await this.stateStore.connect();

            // Initialize scheduler
            this.scheduler = new Scheduler({
                ...this.config.scheduler,
                stateStore: this.config.stateStore,
                diffEngine: this.config.diffEngine,
                scraper: this.config.scraper
            });
            await this.scheduler.initialize();

            // Initialize notification service
            this.notificationService = new NotificationService({
                ...this.config.notification,
                stateStore: this.config.stateStore
            });
            await this.notificationService.initialize();

            // Initialize admin API
            this.adminAPI = new AdminAPI(this.config.admin);
            await this.adminAPI.initialize(
                this.scheduler,
                this.notificationService,
                this.monitoringService,
                this.stateStore
            );

            this.isInitialized = true;
            console.log('ListenerSystem initialized successfully');
        } catch (error) {
            console.error('Failed to initialize ListenerSystem:', error);
            throw error;
        }
    }

    async start() {
        if (!this.isInitialized) {
            throw new Error('ListenerSystem must be initialized before starting');
        }

        if (this.isRunning) {
            console.warn('ListenerSystem is already running');
            return;
        }

        try {
            console.log('Starting ListenerSystem...');

            // Start scheduler
            await this.scheduler.start();

            // Start notification service
            await this.notificationService.start();

            // Start admin API
            await this.adminAPI.start();

            this.isRunning = true;
            console.log('ListenerSystem started successfully');
            
            // Log startup info
            this.monitoringService.info('ListenerSystem started', {
                config: {
                    maxConcurrentPolls: this.config.scheduler.maxConcurrentPolls,
                    pollIntervalMs: this.config.scheduler.pollIntervalMs,
                    adminPort: this.config.admin.port
                }
            });

        } catch (error) {
            console.error('Failed to start ListenerSystem:', error);
            throw error;
        }
    }

    async stop() {
        if (!this.isRunning) {
            console.warn('ListenerSystem is not running');
            return;
        }

        try {
            console.log('Stopping ListenerSystem...');

            // Stop scheduler
            if (this.scheduler) {
                await this.scheduler.stop();
            }

            // Stop notification service
            if (this.notificationService) {
                await this.notificationService.stop();
            }

            // Stop admin API
            if (this.adminAPI) {
                await this.adminAPI.stop();
            }

            this.isRunning = false;
            console.log('ListenerSystem stopped successfully');

        } catch (error) {
            console.error('Error stopping ListenerSystem:', error);
            throw error;
        }
    }

    // Convenience methods for adding targets
    async addPollingTarget(targetConfig) {
        if (!this.isRunning) {
            throw new Error('ListenerSystem must be running to add targets');
        }
        return await this.scheduler.addPollingTarget(targetConfig);
    }

    async removePollingTarget(targetId) {
        if (!this.isRunning) {
            throw new Error('ListenerSystem must be running to remove targets');
        }
        return await this.scheduler.removePollingTarget(targetId);
    }

    async updatePollingTarget(targetId, updates) {
        if (!this.isRunning) {
            throw new Error('ListenerSystem must be running to update targets');
        }
        return await this.scheduler.updatePollingTarget(targetId, updates);
    }

    // Convenience methods for subscribers
    async addSubscriber(subscriberConfig) {
        if (!this.isRunning) {
            throw new Error('ListenerSystem must be running to add subscribers');
        }
        return await this.notificationService.addSubscriber(subscriberConfig);
    }

    async removeSubscriber(subscriberId) {
        if (!this.isRunning) {
            throw new Error('ListenerSystem must be running to remove subscribers');
        }
        return await this.notificationService.removeSubscriber(subscriberId);
    }

    // Status and health methods
    async getStatus() {
        if (!this.isInitialized) {
            return { status: 'not_initialized' };
        }

        try {
            const schedulerStatus = this.scheduler ? await this.scheduler.getStatus() : null;
            const health = this.monitoringService ? await this.monitoringService.performHealthCheck() : null;
            const eventStats = this.notificationService ? await this.notificationService.getEventStats() : null;

            return {
                status: this.isRunning ? 'running' : 'stopped',
                initialized: this.isInitialized,
                scheduler: schedulerStatus,
                health: health,
                events: eventStats,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                status: 'error',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    async getHealth() {
        if (!this.monitoringService) {
            return { status: 'unhealthy', error: 'Monitoring service not initialized' };
        }
        return await this.monitoringService.performHealthCheck();
    }

    async getMetrics() {
        if (!this.monitoringService) {
            return null;
        }
        return await this.monitoringService.getMetrics();
    }

    async getDashboard() {
        if (!this.monitoringService) {
            return null;
        }
        return await this.monitoringService.getDashboardData();
    }

    // Manual operations
    async forcePoll(targetId) {
        if (!this.isRunning) {
            throw new Error('ListenerSystem must be running to force poll');
        }
        
        const target = await this.stateStore.getPollingTarget(targetId);
        if (!target) {
            throw new Error(`Target not found: ${targetId}`);
        }

        await this.scheduler.pollTarget(target);
        return { message: 'Poll completed', targetId };
    }

    async forceRescan(targetId) {
        if (!this.isRunning) {
            throw new Error('ListenerSystem must be running to force rescan');
        }
        
        const target = await this.stateStore.getPollingTarget(targetId);
        if (!target) {
            throw new Error(`Target not found: ${targetId}`);
        }

        await this.scheduler.pollTarget(target, true);
        return { message: 'Rescan completed', targetId };
    }

    async runReconciliation() {
        if (!this.isRunning) {
            throw new Error('ListenerSystem must be running to run reconciliation');
        }

        await this.scheduler.runReconciliation();
        return { message: 'Reconciliation completed' };
    }

    // Configuration methods
    getConfig() {
        return {
            scheduler: this.config.scheduler,
            notification: this.config.notification,
            monitoring: this.config.monitoring,
            admin: this.config.admin
        };
    }

    updateConfig(updates) {
        Object.keys(updates).forEach(key => {
            if (this.config[key]) {
                this.config[key] = { ...this.config[key], ...updates[key] };
            }
        });
    }
}

module.exports = { ListenerSystem };
