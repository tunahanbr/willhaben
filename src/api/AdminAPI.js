const express = require('express');
const { Scheduler } = require('../scheduler/Scheduler');
const { NotificationService } = require('../services/NotificationService');
const { MonitoringService } = require('../services/MonitoringService');
const { StateStore } = require('../stores/StateStore');

class AdminAPI {
    constructor(config = {}) {
        this.config = {
            port: config.port || 3001,
            basePath: config.basePath || '/api/admin',
            ...config
        };
        
        this.app = express();
        this.scheduler = null;
        this.notificationService = null;
        this.monitoringService = null;
        this.stateStore = null;
        
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        
        // CORS
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
            if (req.method === 'OPTIONS') {
                res.sendStatus(200);
            } else {
                next();
            }
        });

        // Request logging
        this.app.use((req, res, next) => {
            console.log(`${req.method} ${req.path}`, req.body);
            next();
        });

        // Error handling
        this.app.use((err, req, res, next) => {
            console.error('API Error:', err);
            res.status(500).json({ error: err.message });
        });
    }

    setupRoutes() {
        const router = express.Router();

        // Health check
        router.get('/health', async (req, res) => {
            try {
                const health = await this.monitoringService.performHealthCheck();
                res.json(health);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // System status
        router.get('/status', async (req, res) => {
            try {
                const status = await this.scheduler.getStatus();
                res.json(status);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Metrics
        router.get('/metrics', async (req, res) => {
            try {
                const metrics = await this.monitoringService.getMetrics();
                res.set('Content-Type', 'text/plain');
                res.send(metrics);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Dashboard data
        router.get('/dashboard', async (req, res) => {
            try {
                const dashboard = await this.monitoringService.getDashboardData();
                res.json(dashboard);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Polling targets management
        router.get('/targets', async (req, res) => {
            try {
                const targets = await this.stateStore.getAllPollingTargets();
                res.json(targets);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/targets', async (req, res) => {
            try {
                const target = await this.scheduler.addPollingTarget(req.body);
                res.status(201).json(target);
            } catch (error) {
                res.status(400).json({ error: error.message });
            }
        });

        router.get('/targets/:id', async (req, res) => {
            try {
                const target = await this.stateStore.getPollingTarget(req.params.id);
                if (!target) {
                    return res.status(404).json({ error: 'Target not found' });
                }
                res.json(target);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.put('/targets/:id', async (req, res) => {
            try {
                const target = await this.scheduler.updatePollingTarget(req.params.id, req.body);
                res.json(target);
            } catch (error) {
                res.status(400).json({ error: error.message });
            }
        });

        router.delete('/targets/:id', async (req, res) => {
            try {
                const success = await this.scheduler.removePollingTarget(req.params.id);
                if (success) {
                    res.status(204).send();
                } else {
                    res.status(404).json({ error: 'Target not found' });
                }
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Manual operations
        router.post('/targets/:id/poll', async (req, res) => {
            try {
                const target = await this.stateStore.getPollingTarget(req.params.id);
                if (!target) {
                    return res.status(404).json({ error: 'Target not found' });
                }

                // Force immediate poll
                await this.scheduler.pollTarget(target);
                res.json({ message: 'Poll initiated', targetId: req.params.id });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/targets/:id/rescan', async (req, res) => {
            try {
                const target = await this.stateStore.getPollingTarget(req.params.id);
                if (!target) {
                    return res.status(404).json({ error: 'Target not found' });
                }

                // Force full rescan
                await this.scheduler.pollTarget(target, true);
                res.json({ message: 'Rescan initiated', targetId: req.params.id });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/reconcile', async (req, res) => {
            try {
                await this.scheduler.runReconciliation();
                res.json({ message: 'Reconciliation initiated' });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Listings management
        router.get('/listings', async (req, res) => {
            try {
                const source = req.query.source;
                const listings = await this.stateStore.getAllListings(source);
                res.json(listings);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.get('/listings/:id', async (req, res) => {
            try {
                const listing = await this.stateStore.getListing(req.params.id);
                if (!listing) {
                    return res.status(404).json({ error: 'Listing not found' });
                }
                res.json(listing);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.delete('/listings/:id', async (req, res) => {
            try {
                const success = await this.stateStore.deleteListing(req.params.id);
                if (success) {
                    res.status(204).send();
                } else {
                    res.status(404).json({ error: 'Listing not found' });
                }
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Events management
        router.get('/events', async (req, res) => {
            try {
                const limit = parseInt(req.query.limit) || 100;
                const events = await this.stateStore.getPendingEvents(limit);
                res.json(events);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.get('/events/stats', async (req, res) => {
            try {
                const stats = await this.notificationService.getEventStats();
                res.json(stats);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Subscribers management
        router.get('/subscribers', async (req, res) => {
            try {
                const subscribers = await this.notificationService.getSubscribers();
                res.json(subscribers);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/subscribers', async (req, res) => {
            try {
                const subscriber = await this.notificationService.addSubscriber(req.body);
                res.status(201).json(subscriber);
            } catch (error) {
                res.status(400).json({ error: error.message });
            }
        });

        router.get('/subscribers/:id', async (req, res) => {
            try {
                const subscriber = await this.notificationService.getSubscriber(req.params.id);
                if (!subscriber) {
                    return res.status(404).json({ error: 'Subscriber not found' });
                }
                res.json(subscriber);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.put('/subscribers/:id', async (req, res) => {
            try {
                const subscriber = await this.notificationService.updateSubscriber(req.params.id, req.body);
                res.json(subscriber);
            } catch (error) {
                res.status(400).json({ error: error.message });
            }
        });

        router.delete('/subscribers/:id', async (req, res) => {
            try {
                const success = await this.notificationService.removeSubscriber(req.params.id);
                if (success) {
                    res.status(204).send();
                } else {
                    res.status(404).json({ error: 'Subscriber not found' });
                }
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/subscribers/:id/test', async (req, res) => {
            try {
                await this.notificationService.testSubscriber(req.params.id);
                res.json({ message: 'Test delivery successful' });
            } catch (error) {
                res.status(400).json({ error: error.message });
            }
        });

        // Scheduler control
        router.post('/scheduler/start', async (req, res) => {
            try {
                await this.scheduler.start();
                res.json({ message: 'Scheduler started' });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.post('/scheduler/stop', async (req, res) => {
            try {
                await this.scheduler.stop();
                res.json({ message: 'Scheduler stopped' });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.get('/scheduler/metrics', async (req, res) => {
            try {
                const metrics = this.scheduler.getMetrics();
                res.json(metrics);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Mount router
        this.app.use(this.config.basePath, router);
    }

    async initialize(scheduler, notificationService, monitoringService, stateStore) {
        this.scheduler = scheduler;
        this.notificationService = notificationService;
        this.monitoringService = monitoringService;
        this.stateStore = stateStore;
    }

    async start() {
        return new Promise((resolve, reject) => {
            this.server = this.app.listen(this.config.port, (err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log(`Admin API running on port ${this.config.port}`);
                    console.log(`Base path: ${this.config.basePath}`);
                    resolve();
                }
            });
        });
    }

    async stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(resolve);
            } else {
                resolve();
            }
        });
    }
}

module.exports = { AdminAPI };
