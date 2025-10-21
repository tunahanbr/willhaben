const crypto = require('crypto');

class CanonicalListing {
    constructor(data) {
        this.listingId = data.listingId || data.id;
        this.source = data.source;
        this.firstSeenAt = data.firstSeenAt || new Date();
        this.lastSeenAt = data.lastSeenAt || new Date();
        this.status = data.status || 'ACTIVE';
        
        // Core fields
        this.title = data.title || data.description;
        this.price = data.price;
        this.condition = data.condition;
        this.location = data.location;
        this.url = data.url;
        this.imageUrls = data.imageUrls || data.image_urls || [];
        
        // Metadata
        this.fieldHash = data.fieldHash || this.generateFieldHash();
        this.version = data.version || 1;
        this.etag = data.etag;
        this.lastModified = data.lastModified;
        
        // Tracking
        this.trackedFields = data.trackedFields || ['title', 'price', 'condition', 'location'];
        this.changeHistory = data.changeHistory || [];
        this.meta = data.meta || {};
        
        // Additional fields from scraping
        this.rawData = data.rawData || {};
    }

    generateFieldHash() {
        const trackedData = {};
        this.trackedFields.forEach(field => {
            trackedData[field] = this[field];
        });
        
        const jsonString = JSON.stringify(trackedData, Object.keys(trackedData).sort());
        return crypto.createHash('sha256').update(jsonString).digest('hex');
    }

    updateFields(newData) {
        const oldHash = this.fieldHash;
        const oldVersion = this.version;
        
        // Update fields
        Object.keys(newData).forEach(key => {
            if (this.trackedFields.includes(key) && this[key] !== newData[key]) {
                this[key] = newData[key];
            }
        });
        
        // Update metadata
        this.lastSeenAt = new Date();
        this.version = oldVersion + 1;
        this.fieldHash = this.generateFieldHash();
        
        // Record change
        const changeRecord = {
            version: oldVersion,
            timestamp: new Date(),
            fieldHash: oldHash,
            changes: this.getFieldChanges(newData)
        };
        
        this.changeHistory.push(changeRecord);
        
        return {
            hasChanges: oldHash !== this.fieldHash,
            oldHash,
            newHash: this.fieldHash,
            changes: changeRecord.changes
        };
    }

    getFieldChanges(newData) {
        const changes = [];
        
        this.trackedFields.forEach(field => {
            const oldValue = this[field];
            const newValue = newData[field];
            
            if (oldValue !== newValue) {
                changes.push({
                    field,
                    oldValue,
                    newValue,
                    changeType: this.getChangeType(oldValue, newValue),
                    significance: this.calculateSignificance(field, oldValue, newValue)
                });
            }
        });
        
        return changes;
    }

    getChangeType(oldValue, newValue) {
        if (oldValue === undefined || oldValue === null) return 'ADDED';
        if (newValue === undefined || newValue === null) return 'REMOVED';
        return 'MODIFIED';
    }

    calculateSignificance(field, oldValue, newValue) {
        // Price changes are more significant
        if (field === 'price') {
            if (typeof oldValue === 'number' && typeof newValue === 'number') {
                const percentChange = Math.abs((newValue - oldValue) / oldValue);
                return Math.min(percentChange, 1); // Cap at 1.0
            }
        }
        
        // Title changes are moderately significant
        if (field === 'title') {
            return 0.5;
        }
        
        // Other changes are less significant
        return 0.1;
    }

    toJSON() {
        return {
            listingId: this.listingId,
            source: this.source,
            firstSeenAt: this.firstSeenAt,
            lastSeenAt: this.lastSeenAt,
            status: this.status,
            title: this.title,
            price: this.price,
            condition: this.condition,
            location: this.location,
            url: this.url,
            imageUrls: this.imageUrls,
            fieldHash: this.fieldHash,
            version: this.version,
            etag: this.etag,
            lastModified: this.lastModified,
            trackedFields: this.trackedFields,
            changeHistory: this.changeHistory,
            meta: this.meta,
            rawData: this.rawData
        };
    }

    static fromJSON(data) {
        return new CanonicalListing(data);
    }
}

class ChangeEvent {
    constructor(data) {
        this.eventId = data.eventId || crypto.randomUUID();
        this.eventType = data.eventType; // 'CREATED' | 'UPDATED' | 'REMOVED'
        this.listingId = data.listingId;
        this.source = data.source;
        
        // Change details
        this.changedFields = data.changedFields || [];
        this.fieldHashBefore = data.fieldHashBefore;
        this.fieldHashAfter = data.fieldHashAfter;
        this.detectedAt = data.detectedAt || new Date();
        this.version = data.version;
        
        // Context
        this.confidence = data.confidence || 1.0;
        this.significance = data.significance || 'LOW';
        this.metadata = data.metadata || {};
    }

    toJSON() {
        return {
            eventId: this.eventId,
            eventType: this.eventType,
            listingId: this.listingId,
            source: this.source,
            changedFields: this.changedFields,
            fieldHashBefore: this.fieldHashBefore,
            fieldHashAfter: this.fieldHashAfter,
            detectedAt: this.detectedAt,
            version: this.version,
            confidence: this.confidence,
            significance: this.significance,
            metadata: this.metadata
        };
    }
}

module.exports = {
    CanonicalListing,
    ChangeEvent
};
