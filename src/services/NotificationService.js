const axios = require('axios');
const crypto = require('crypto');
const { StateStore } = require('../stores/StateStore');

class NotificationService {
    constructor(config = {}) {
        this.config = {
            maxRetries: config.maxRetries || 3,
            retryDelay: config.retryDelay || 1000,
            batchSize: config.batchSize || 10,
            processingInterval: config.processingInterval || 5000, // 5 seconds
            webhookSecret: config.webhookSecret || null,
            ...config
        };
        
        this.stateStore = new StateStore(config.stateStore);
        this.isRunning = false;
        this.processingInterval = null;
        this.subscribers = new Map(); // webhook URLs, websocket connections, etc.
    }

    async initialize() {
        try {
            await this.stateStore.connect();
            console.log('NotificationService initialized successfully');
        } catch (error) {
            console.error('Failed to initialize NotificationService:', error);
            throw error;
        }
    }

    async start() {
        if (this.isRunning) {
            console.warn('NotificationService is already running');
            return;
        }

        this.isRunning = true;
        console.log('Starting notification service...');

        // Start event processing loop
        this.processingInterval = setInterval(() => {
            this.processPendingEvents();
        }, this.config.processingInterval);

        console.log('NotificationService started successfully');
    }

    async stop() {
        if (!this.isRunning) {
            console.warn('NotificationService is not running');
            return;
        }

        this.isRunning = false;
        console.log('Stopping notification service...');

        if (this.processingInterval) {
            clearInterval(this.processingInterval);
        }

        await this.stateStore.disconnect();
        console.log('NotificationService stopped successfully');
    }

    async addSubscriber(subscriberConfig) {
        const subscriber = {
            id: subscriberConfig.id || crypto.randomUUID(),
            type: subscriberConfig.type, // 'webhook', 'websocket', 'email'
            endpoint: subscriberConfig.endpoint,
            config: subscriberConfig.config || {},
            enabled: subscriberConfig.enabled !== false,
            createdAt: new Date()
        };

        this.subscribers.set(subscriber.id, subscriber);
        console.log(`Added subscriber: ${subscriber.id} (${subscriber.type})`);
        return subscriber;
    }

    async removeSubscriber(subscriberId) {
        if (this.subscribers.has(subscriberId)) {
            this.subscribers.delete(subscriberId);
            console.log(`Removed subscriber: ${subscriberId}`);
            return true;
        }
        return false;
    }

    async processPendingEvents() {
        if (!this.isRunning) return;

        try {
            const pendingEvents = await this.stateStore.getPendingEvents(this.config.batchSize);
            
            if (pendingEvents.length === 0) {
                return;
            }

            console.log(`Processing ${pendingEvents.length} pending events`);

            for (const event of pendingEvents) {
                await this.processEvent(event);
            }

        } catch (error) {
            console.error('Error processing pending events:', error);
        }
    }

    async processEvent(event) {
        try {
            console.log(`Processing event: ${event.eventId} (${event.eventType})`);

            const results = await Promise.allSettled(
                Array.from(this.subscribers.values())
                    .filter(subscriber => subscriber.enabled)
                    .map(subscriber => this.deliverToSubscriber(event, subscriber))
            );

            // Check if all deliveries succeeded
            const failures = results.filter(result => result.status === 'rejected');
            
            if (failures.length === 0) {
                await this.stateStore.markEventProcessed(event.eventId, true);
                console.log(`Event ${event.eventId} processed successfully`);
            } else {
                console.warn(`Event ${event.eventId} had ${failures.length} delivery failures`);
                // Mark as failed but keep retrying
                await this.stateStore.markEventProcessed(event.eventId, false);
            }

        } catch (error) {
            console.error(`Failed to process event ${event.eventId}:`, error);
            await this.stateStore.markEventProcessed(event.eventId, false);
        }
    }

    async deliverToSubscriber(event, subscriber) {
        try {
            switch (subscriber.type) {
                case 'webhook':
                    return await this.deliverWebhook(event, subscriber);
                case 'websocket':
                    return await this.deliverWebSocket(event, subscriber);
                case 'email':
                    return await this.deliverEmail(event, subscriber);
                default:
                    throw new Error(`Unknown subscriber type: ${subscriber.type}`);
            }
        } catch (error) {
            console.error(`Delivery failed to subscriber ${subscriber.id}:`, error);
            throw error;
        }
    }

    async deliverWebhook(event, subscriber) {
        const payload = {
            eventId: event.eventId,
            eventType: event.eventType,
            listingId: event.listingId,
            source: event.source,
            changedFields: event.changedFields,
            fieldHashBefore: event.fieldHashBefore,
            fieldHashAfter: event.fieldHashAfter,
            detectedAt: event.detectedAt,
            version: event.version,
            confidence: event.confidence,
            significance: event.significance,
            metadata: event.metadata,
            timestamp: new Date().toISOString()
        };

        // Add signature if secret is configured
        if (this.config.webhookSecret) {
            payload.signature = this.generateWebhookSignature(payload);
        }

        const response = await axios.post(subscriber.endpoint, payload, {
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Willhaben-Listener/1.0',
                'X-Event-Type': event.eventType,
                'X-Event-ID': event.eventId
            }
        });

        if (response.status >= 200 && response.status < 300) {
            console.log(`Webhook delivered successfully to ${subscriber.endpoint}`);
            return true;
        } else {
            throw new Error(`Webhook delivery failed with status ${response.status}`);
        }
    }

    async deliverWebSocket(event, subscriber) {
        // This would integrate with a WebSocket server
        // For now, we'll simulate the delivery
        console.log(`WebSocket delivery to ${subscriber.endpoint}:`, event.eventType);
        return true;
    }

    async deliverEmail(event, subscriber) {
        // This would integrate with an email service
        // For now, we'll simulate the delivery
        console.log(`Email delivery to ${subscriber.endpoint}:`, event.eventType);
        return true;
    }

    generateWebhookSignature(payload) {
        if (!this.config.webhookSecret) return null;
        
        const payloadString = JSON.stringify(payload);
        const signature = crypto
            .createHmac('sha256', this.config.webhookSecret)
            .update(payloadString)
            .digest('hex');
        
        return `sha256=${signature}`;
    }

    verifyWebhookSignature(payload, signature) {
        if (!this.config.webhookSecret) return true;
        
        const expectedSignature = this.generateWebhookSignature(payload);
        return signature === expectedSignature;
    }

    async getSubscribers() {
        return Array.from(this.subscribers.values());
    }

    async getSubscriber(subscriberId) {
        return this.subscribers.get(subscriberId);
    }

    async updateSubscriber(subscriberId, updates) {
        const subscriber = this.subscribers.get(subscriberId);
        if (!subscriber) {
            throw new Error(`Subscriber not found: ${subscriberId}`);
        }

        Object.keys(updates).forEach(key => {
            if (subscriber[key] !== undefined) {
                subscriber[key] = updates[key];
            }
        });

        subscriber.updatedAt = new Date();
        this.subscribers.set(subscriberId, subscriber);
        
        console.log(`Updated subscriber: ${subscriberId}`);
        return subscriber;
    }

    async getEventStats() {
        try {
            // This would query the database for event statistics
            // For now, return mock data
            return {
                totalEvents: 0,
                pendingEvents: 0,
                processedEvents: 0,
                failedEvents: 0,
                subscribers: this.subscribers.size,
                lastProcessedAt: new Date()
            };
        } catch (error) {
            console.error('Failed to get event stats:', error);
            return null;
        }
    }

    async testSubscriber(subscriberId) {
        const subscriber = this.subscribers.get(subscriberId);
        if (!subscriber) {
            throw new Error(`Subscriber not found: ${subscriberId}`);
        }

        const testEvent = {
            eventId: crypto.randomUUID(),
            eventType: 'TEST',
            listingId: 'test-listing',
            source: 'test-source',
            changedFields: [],
            fieldHashBefore: null,
            fieldHashAfter: null,
            detectedAt: new Date(),
            version: 1,
            confidence: 1.0,
            significance: 'LOW',
            metadata: { test: true }
        };

        try {
            await this.deliverToSubscriber(testEvent, subscriber);
            console.log(`Test delivery successful for subscriber: ${subscriberId}`);
            return true;
        } catch (error) {
            console.error(`Test delivery failed for subscriber ${subscriberId}:`, error);
            throw error;
        }
    }
}

module.exports = { NotificationService };
