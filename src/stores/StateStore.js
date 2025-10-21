const sqlite3 = require('sqlite3').verbose();
const { createClient } = require('redis');
const { CanonicalListing } = require('../models/Listing');
const { PollingTarget } = require('../models/PollingTarget');
const { ChangeEvent } = require('../models/Listing');

class StateStore {
    constructor(config = {}) {
        this.config = {
            redis: {
                host: config.redis?.host || 'localhost',
                port: config.redis?.port || 6379,
                password: config.redis?.password || null,
                db: config.redis?.db || 0
            },
            sqlite: {
                path: config.sqlite?.path || './data/listener.db'
            }
        };
        
        this.redis = null;
        this.db = null;
        this.isConnected = false;
    }

    async connect() {
        try {
            // Connect to Redis
            this.redis = createClient({
                socket: {
                    host: this.config.redis.host,
                    port: this.config.redis.port
                },
                password: this.config.redis.password,
                database: this.config.redis.db
            });

            this.redis.on('error', (err) => {
                console.error('Redis Client Error:', err);
            });

            await this.redis.connect();

            // Connect to SQLite
            this.db = new sqlite3.Database(this.config.sqlite.path);
            
            // Initialize database schema
            await this.initializeSchema();
            
            this.isConnected = true;
            console.log('StateStore connected successfully');
        } catch (error) {
            console.error('Failed to connect to StateStore:', error);
            throw error;
        }
    }

    async initializeSchema() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Listings table
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS listings (
                        listing_id TEXT PRIMARY KEY,
                        source TEXT NOT NULL,
                        first_seen_at DATETIME NOT NULL,
                        last_seen_at DATETIME NOT NULL,
                        status TEXT NOT NULL DEFAULT 'ACTIVE',
                        title TEXT,
                        price REAL,
                        condition TEXT,
                        location TEXT,
                        url TEXT,
                        image_urls TEXT,
                        field_hash TEXT NOT NULL,
                        version INTEGER NOT NULL DEFAULT 1,
                        etag TEXT,
                        last_modified DATETIME,
                        tracked_fields TEXT,
                        change_history TEXT,
                        meta TEXT,
                        raw_data TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Polling targets table
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS polling_targets (
                        id TEXT PRIMARY KEY,
                        url TEXT NOT NULL,
                        domain TEXT NOT NULL,
                        base_interval INTEGER NOT NULL DEFAULT 300,
                        min_interval INTEGER NOT NULL DEFAULT 60,
                        max_interval INTEGER NOT NULL DEFAULT 3600,
                        adaptive_policy TEXT,
                        rate_limit_policy TEXT,
                        last_polled_at DATETIME,
                        consecutive_failures INTEGER DEFAULT 0,
                        circuit_breaker_state TEXT DEFAULT 'CLOSED',
                        last_success_at DATETIME,
                        change_history TEXT,
                        current_change_rate INTEGER DEFAULT 0,
                        tracked_fields TEXT,
                        grace_period INTEGER DEFAULT 300,
                        enabled BOOLEAN DEFAULT 1,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Events table (outbox)
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS events (
                        event_id TEXT PRIMARY KEY,
                        event_type TEXT NOT NULL,
                        listing_id TEXT NOT NULL,
                        source TEXT NOT NULL,
                        changed_fields TEXT,
                        field_hash_before TEXT,
                        field_hash_after TEXT,
                        detected_at DATETIME NOT NULL,
                        version INTEGER NOT NULL,
                        confidence REAL DEFAULT 1.0,
                        significance TEXT DEFAULT 'LOW',
                        metadata TEXT,
                        status TEXT DEFAULT 'PENDING',
                        retry_count INTEGER DEFAULT 0,
                        last_retry_at DATETIME,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Create indexes
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_listings_source ON listings(source)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_listings_last_seen ON listings(last_seen_at)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_events_status ON events(status)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_events_listing_id ON events(listing_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_events_detected_at ON events(detected_at)`);

                resolve();
            });
        });
    }

    // Listing operations
    async getListing(listingId) {
        try {
            // Try Redis first
            const cached = await this.redis.get(`listing:${listingId}`);
            if (cached) {
                return CanonicalListing.fromJSON(JSON.parse(cached));
            }

            // Fallback to SQLite
            return new Promise((resolve, reject) => {
                this.db.get(
                    'SELECT * FROM listings WHERE listing_id = ?',
                    [listingId],
                    (err, row) => {
                        if (err) reject(err);
                        else if (row) {
                            const listing = this.rowToListing(row);
                            // Cache in Redis
                            this.redis.setEx(`listing:${listingId}`, 3600, JSON.stringify(listing.toJSON()));
                            resolve(listing);
                        } else {
                            resolve(null);
                        }
                    }
                );
            });
        } catch (error) {
            console.error('Error getting listing:', error);
            return null;
        }
    }

    async saveListing(listing) {
        try {
            const data = listing.toJSON();
            
            // Save to SQLite
            await new Promise((resolve, reject) => {
                this.db.run(`
                    INSERT OR REPLACE INTO listings (
                        listing_id, source, first_seen_at, last_seen_at, status,
                        title, price, condition, location, url, image_urls,
                        field_hash, version, etag, last_modified, tracked_fields,
                        change_history, meta, raw_data, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    data.listingId, data.source, data.firstSeenAt, data.lastSeenAt, data.status,
                    data.title, data.price, data.condition, data.location, data.url, JSON.stringify(data.imageUrls),
                    data.fieldHash, data.version, data.etag, data.lastModified, JSON.stringify(data.trackedFields),
                    JSON.stringify(data.changeHistory), JSON.stringify(data.meta), JSON.stringify(data.rawData), new Date()
                ], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Cache in Redis
            await this.redis.setEx(`listing:${data.listingId}`, 3600, JSON.stringify(data));
            
            return true;
        } catch (error) {
            console.error('Error saving listing:', error);
            return false;
        }
    }

    async getAllListings(source = null) {
        return new Promise((resolve, reject) => {
            const query = source ? 
                'SELECT * FROM listings WHERE source = ?' : 
                'SELECT * FROM listings';
            const params = source ? [source] : [];
            
            this.db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else {
                    const listings = rows.map(row => this.rowToListing(row));
                    resolve(listings);
                }
            });
        });
    }

    async deleteListing(listingId) {
        try {
            // Remove from SQLite
            await new Promise((resolve, reject) => {
                this.db.run('DELETE FROM listings WHERE listing_id = ?', [listingId], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Remove from Redis
            await this.redis.del(`listing:${listingId}`);
            
            return true;
        } catch (error) {
            console.error('Error deleting listing:', error);
            return false;
        }
    }

    // Polling target operations
    async getPollingTarget(targetId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM polling_targets WHERE id = ?',
                [targetId],
                (err, row) => {
                    if (err) reject(err);
                    else if (row) {
                        resolve(this.rowToPollingTarget(row));
                    } else {
                        resolve(null);
                    }
                }
            );
        });
    }

    async savePollingTarget(target) {
        const data = target.toJSON();
        
        return new Promise((resolve, reject) => {
            this.db.run(`
                INSERT OR REPLACE INTO polling_targets (
                    id, url, domain, base_interval, min_interval, max_interval,
                    adaptive_policy, rate_limit_policy, last_polled_at, consecutive_failures,
                    circuit_breaker_state, last_success_at, change_history, current_change_rate,
                    tracked_fields, grace_period, enabled, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                data.id, data.url, data.domain, data.baseInterval, data.minInterval, data.maxInterval,
                JSON.stringify(data.adaptivePolicy), JSON.stringify(data.rateLimitPolicy), data.lastPolledAt, data.consecutiveFailures,
                data.circuitBreakerState, data.lastSuccessAt, JSON.stringify(data.changeHistory), data.currentChangeRate,
                JSON.stringify(data.trackedFields), data.gracePeriod, data.enabled, new Date()
            ], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async getAllPollingTargets() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM polling_targets', (err, rows) => {
                if (err) reject(err);
                else {
                    const targets = rows.map(row => this.rowToPollingTarget(row));
                    resolve(targets);
                }
            });
        });
    }

    async deletePollingTarget(targetId) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM polling_targets WHERE id = ?', [targetId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // Event operations (Outbox pattern)
    async saveEvent(event) {
        const data = event.toJSON();
        
        return new Promise((resolve, reject) => {
            this.db.run(`
                INSERT INTO events (
                    event_id, event_type, listing_id, source, changed_fields,
                    field_hash_before, field_hash_after, detected_at, version,
                    confidence, significance, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                data.eventId, data.eventType, data.listingId, data.source, JSON.stringify(data.changedFields),
                data.fieldHashBefore, data.fieldHashAfter, data.detectedAt, data.version,
                data.confidence, data.significance, JSON.stringify(data.metadata)
            ], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async getPendingEvents(limit = 100) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM events WHERE status = "PENDING" ORDER BY created_at ASC LIMIT ?',
                [limit],
                (err, rows) => {
                    if (err) reject(err);
                    else {
                        const events = rows.map(row => this.rowToEvent(row));
                        resolve(events);
                    }
                }
            );
        });
    }

    async markEventProcessed(eventId, success = true) {
        return new Promise((resolve, reject) => {
            const status = success ? 'PROCESSED' : 'FAILED';
            this.db.run(
                'UPDATE events SET status = ?, last_retry_at = ? WHERE event_id = ?',
                [status, new Date(), eventId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    // Helper methods
    rowToListing(row) {
        return new CanonicalListing({
            listingId: row.listing_id,
            source: row.source,
            firstSeenAt: new Date(row.first_seen_at),
            lastSeenAt: new Date(row.last_seen_at),
            status: row.status,
            title: row.title,
            price: row.price,
            condition: row.condition,
            location: row.location,
            url: row.url,
            imageUrls: JSON.parse(row.image_urls || '[]'),
            fieldHash: row.field_hash,
            version: row.version,
            etag: row.etag,
            lastModified: row.last_modified ? new Date(row.last_modified) : null,
            trackedFields: JSON.parse(row.tracked_fields || '[]'),
            changeHistory: JSON.parse(row.change_history || '[]'),
            meta: JSON.parse(row.meta || '{}'),
            rawData: JSON.parse(row.raw_data || '{}')
        });
    }

    rowToPollingTarget(row) {
        return new PollingTarget({
            id: row.id,
            url: row.url,
            domain: row.domain,
            baseInterval: row.base_interval,
            minInterval: row.min_interval,
            maxInterval: row.max_interval,
            adaptivePolicy: JSON.parse(row.adaptive_policy || '{}'),
            rateLimitPolicy: JSON.parse(row.rate_limit_policy || '{}'),
            lastPolledAt: row.last_polled_at ? new Date(row.last_polled_at) : null,
            consecutiveFailures: row.consecutive_failures,
            circuitBreakerState: row.circuit_breaker_state,
            lastSuccessAt: row.last_success_at ? new Date(row.last_success_at) : null,
            changeHistory: JSON.parse(row.change_history || '[]'),
            currentChangeRate: row.current_change_rate,
            trackedFields: JSON.parse(row.tracked_fields || '[]'),
            gracePeriod: row.grace_period,
            enabled: Boolean(row.enabled),
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at)
        });
    }

    rowToEvent(row) {
        return new ChangeEvent({
            eventId: row.event_id,
            eventType: row.event_type,
            listingId: row.listing_id,
            source: row.source,
            changedFields: JSON.parse(row.changed_fields || '[]'),
            fieldHashBefore: row.field_hash_before,
            fieldHashAfter: row.field_hash_after,
            detectedAt: new Date(row.detected_at),
            version: row.version,
            confidence: row.confidence,
            significance: row.significance,
            metadata: JSON.parse(row.metadata || '{}')
        });
    }

    async disconnect() {
        if (this.redis) {
            await this.redis.disconnect();
        }
        if (this.db) {
            this.db.close();
        }
        this.isConnected = false;
    }
}

module.exports = { StateStore };
