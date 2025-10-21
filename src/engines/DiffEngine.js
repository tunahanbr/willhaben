const crypto = require('crypto');
const { CanonicalListing, ChangeEvent } = require('../models/Listing');

class DiffEngine {
    constructor(config = {}) {
        this.config = {
            significanceThresholds: {
                price: config.significanceThresholds?.price || 0.05, // 5% price change
                title: config.significanceThresholds?.title || 0.3,    // 30% title similarity
                condition: config.significanceThresholds?.condition || 0.0,
                location: config.significanceThresholds?.location || 0.0
            },
            ignorePatterns: config.ignorePatterns || [],
            semanticAnalysis: config.semanticAnalysis !== false,
            minSignificance: config.minSignificance || 0.1
        };
    }

    /**
     * Compare scraped listings with canonical state and detect changes
     * @param {Array} scrapedListings - Freshly scraped listings
     * @param {Array} canonicalListings - Existing canonical listings
     * @param {string} source - Source URL/domain
     * @returns {Array} Array of ChangeEvent objects
     */
    detectChanges(scrapedListings, canonicalListings, source) {
        const changes = [];
        const scrapedMap = new Map(scrapedListings.map(listing => [listing.id, listing]));
        const canonicalMap = new Map(canonicalListings.map(listing => [listing.listingId, listing]));

        // Detect new listings
        for (const [id, scrapedListing] of scrapedMap) {
            if (!canonicalMap.has(id)) {
                const changeEvent = this.createChangeEvent({
                    eventType: 'CREATED',
                    listingId: id,
                    source,
                    scrapedListing,
                    canonicalListing: null
                });
                changes.push(changeEvent);
            }
        }

        // Detect updates and removals
        for (const [id, canonicalListing] of canonicalMap) {
            const scrapedListing = scrapedMap.get(id);
            
            if (!scrapedListing) {
                // Check if this is a removal (not just missing from current page)
                const changeEvent = this.createChangeEvent({
                    eventType: 'REMOVED',
                    listingId: id,
                    source,
                    scrapedListing: null,
                    canonicalListing
                });
                changes.push(changeEvent);
            } else {
                // Check for updates
                const fieldChanges = this.compareListings(canonicalListing, scrapedListing);
                if (fieldChanges.length > 0) {
                    const changeEvent = this.createChangeEvent({
                        eventType: 'UPDATED',
                        listingId: id,
                        source,
                        scrapedListing,
                        canonicalListing,
                        fieldChanges
                    });
                    changes.push(changeEvent);
                }
            }
        }

        return changes.filter(change => this.isSignificantChange(change));
    }

    /**
     * Compare two listings and return field-level changes
     * @param {CanonicalListing} canonical - Existing canonical listing
     * @param {Object} scraped - Freshly scraped listing data
     * @returns {Array} Array of field changes
     */
    compareListings(canonical, scraped) {
        const changes = [];
        const trackedFields = canonical.trackedFields;

        for (const field of trackedFields) {
            const oldValue = canonical[field];
            const newValue = scraped[field];

            if (this.hasFieldChanged(field, oldValue, newValue)) {
                const change = {
                    field,
                    oldValue,
                    newValue,
                    changeType: this.getChangeType(oldValue, newValue),
                    significance: this.calculateFieldSignificance(field, oldValue, newValue)
                };
                changes.push(change);
            }
        }

        return changes;
    }

    /**
     * Check if a field has meaningfully changed
     * @param {string} field - Field name
     * @param {any} oldValue - Previous value
     * @param {any} newValue - New value
     * @returns {boolean} True if field has changed
     */
    hasFieldChanged(field, oldValue, newValue) {
        // Handle null/undefined values
        if (oldValue === null || oldValue === undefined) {
            return newValue !== null && newValue !== undefined;
        }
        if (newValue === null || newValue === undefined) {
            return oldValue !== null && oldValue !== undefined;
        }

        // Check against ignore patterns
        if (this.shouldIgnoreField(field, oldValue, newValue)) {
            return false;
        }

        // Type-specific comparisons
        if (typeof oldValue === 'number' && typeof newValue === 'number') {
            return oldValue !== newValue;
        }

        if (typeof oldValue === 'string' && typeof newValue === 'string') {
            // Normalize strings for comparison
            const normalizedOld = this.normalizeString(oldValue);
            const normalizedNew = this.normalizeString(newValue);
            return normalizedOld !== normalizedNew;
        }

        // Array comparisons
        if (Array.isArray(oldValue) && Array.isArray(newValue)) {
            return !this.arraysEqual(oldValue, newValue);
        }

        // Object comparisons
        if (typeof oldValue === 'object' && typeof newValue === 'object') {
            return JSON.stringify(oldValue) !== JSON.stringify(newValue);
        }

        // Default comparison
        return oldValue !== newValue;
    }

    /**
     * Check if field should be ignored based on patterns
     * @param {string} field - Field name
     * @param {any} oldValue - Previous value
     * @param {any} newValue - New value
     * @returns {boolean} True if field should be ignored
     */
    shouldIgnoreField(field, oldValue, newValue) {
        for (const pattern of this.config.ignorePatterns) {
            try {
                const regex = new RegExp(pattern, 'i');
                if (regex.test(field) || 
                    (typeof oldValue === 'string' && regex.test(oldValue)) ||
                    (typeof newValue === 'string' && regex.test(newValue))) {
                    return true;
                }
            } catch (error) {
                console.warn(`Invalid ignore pattern: ${pattern}`, error);
            }
        }
        return false;
    }

    /**
     * Normalize string for comparison
     * @param {string} str - String to normalize
     * @returns {string} Normalized string
     */
    normalizeString(str) {
        return str
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')  // Normalize whitespace
            .replace(/[^\w\s]/g, ''); // Remove special characters
    }

    /**
     * Check if two arrays are equal
     * @param {Array} arr1 - First array
     * @param {Array} arr2 - Second array
     * @returns {boolean} True if arrays are equal
     */
    arraysEqual(arr1, arr2) {
        if (arr1.length !== arr2.length) return false;
        
        for (let i = 0; i < arr1.length; i++) {
            if (arr1[i] !== arr2[i]) return false;
        }
        
        return true;
    }

    /**
     * Get change type for a field
     * @param {any} oldValue - Previous value
     * @param {any} newValue - New value
     * @returns {string} Change type
     */
    getChangeType(oldValue, newValue) {
        if (oldValue === null || oldValue === undefined) return 'ADDED';
        if (newValue === null || newValue === undefined) return 'REMOVED';
        return 'MODIFIED';
    }

    /**
     * Calculate significance score for a field change
     * @param {string} field - Field name
     * @param {any} oldValue - Previous value
     * @param {any} newValue - New value
     * @returns {number} Significance score (0-1)
     */
    calculateFieldSignificance(field, oldValue, newValue) {
        // Price changes are highly significant
        if (field === 'price' && typeof oldValue === 'number' && typeof newValue === 'number') {
            const percentChange = Math.abs((newValue - oldValue) / oldValue);
            return Math.min(percentChange, 1.0);
        }

        // Title changes with semantic analysis
        if (field === 'title' && typeof oldValue === 'string' && typeof newValue === 'string') {
            if (this.config.semanticAnalysis) {
                return this.calculateSemanticSimilarity(oldValue, newValue);
            }
            return 0.5; // Default moderate significance
        }

        // Condition changes
        if (field === 'condition') {
            return 0.3;
        }

        // Location changes
        if (field === 'location') {
            return 0.2;
        }

        // Default low significance
        return 0.1;
    }

    /**
     * Calculate semantic similarity between two strings
     * @param {string} str1 - First string
     * @param {string} str2 - Second string
     * @returns {number} Similarity score (0-1)
     */
    calculateSemanticSimilarity(str1, str2) {
        const normalized1 = this.normalizeString(str1);
        const normalized2 = this.normalizeString(str2);

        // Simple word-based similarity
        const words1 = normalized1.split(' ');
        const words2 = normalized2.split(' ');
        
        const commonWords = words1.filter(word => words2.includes(word));
        const totalWords = Math.max(words1.length, words2.length);
        
        return commonWords.length / totalWords;
    }

    /**
     * Create a change event from detected changes
     * @param {Object} params - Change event parameters
     * @returns {ChangeEvent} Change event object
     */
    createChangeEvent(params) {
        const { eventType, listingId, source, scrapedListing, canonicalListing, fieldChanges } = params;
        
        let changedFields = [];
        let fieldHashBefore = null;
        let fieldHashAfter = null;
        let version = 1;
        let confidence = 1.0;
        let significance = 'LOW';

        if (eventType === 'CREATED') {
            fieldHashAfter = this.generateFieldHash(scrapedListing);
            significance = 'HIGH';
        } else if (eventType === 'UPDATED') {
            changedFields = fieldChanges || [];
            fieldHashBefore = canonicalListing.fieldHash;
            fieldHashAfter = this.generateFieldHash(scrapedListing);
            version = canonicalListing.version + 1;
            
            // Calculate overall significance
            const maxSignificance = Math.max(...changedFields.map(c => c.significance));
            if (maxSignificance > 0.5) significance = 'HIGH';
            else if (maxSignificance > 0.2) significance = 'MEDIUM';
            
            confidence = this.calculateConfidence(changedFields);
        } else if (eventType === 'REMOVED') {
            fieldHashBefore = canonicalListing.fieldHash;
            significance = 'HIGH';
        }

        return new ChangeEvent({
            eventType,
            listingId,
            source,
            changedFields,
            fieldHashBefore,
            fieldHashAfter,
            version,
            confidence,
            significance,
            metadata: {
                detectedAt: new Date(),
                source: source,
                changeCount: changedFields.length
            }
        });
    }

    /**
     * Generate field hash for a listing
     * @param {Object} listing - Listing data
     * @returns {string} Field hash
     */
    generateFieldHash(listing) {
        const trackedData = {};
        const trackedFields = ['title', 'price', 'condition', 'location'];
        
        trackedFields.forEach(field => {
            trackedData[field] = listing[field];
        });
        
        const jsonString = JSON.stringify(trackedData, Object.keys(trackedData).sort());
        return crypto.createHash('sha256').update(jsonString).digest('hex');
    }

    /**
     * Calculate confidence score for changes
     * @param {Array} fieldChanges - Array of field changes
     * @returns {number} Confidence score (0-1)
     */
    calculateConfidence(fieldChanges) {
        if (fieldChanges.length === 0) return 0;
        
        // Higher confidence for more significant changes
        const avgSignificance = fieldChanges.reduce((sum, change) => sum + change.significance, 0) / fieldChanges.length;
        return Math.min(avgSignificance * 2, 1.0);
    }

    /**
     * Check if a change is significant enough to emit
     * @param {ChangeEvent} changeEvent - Change event to check
     * @returns {boolean} True if change is significant
     */
    isSignificantChange(changeEvent) {
        if (changeEvent.eventType === 'CREATED' || changeEvent.eventType === 'REMOVED') {
            return true; // Always emit creation/removal events
        }

        if (changeEvent.eventType === 'UPDATED') {
            // Check if any field change exceeds significance threshold
            return changeEvent.changedFields.some(change => 
                change.significance >= this.config.minSignificance
            );
        }

        return false;
    }

    /**
     * Update canonical listing with changes
     * @param {CanonicalListing} canonicalListing - Existing canonical listing
     * @param {Object} scrapedListing - Freshly scraped listing
     * @returns {CanonicalListing} Updated canonical listing
     */
    updateCanonicalListing(canonicalListing, scrapedListing) {
        const updateResult = canonicalListing.updateFields(scrapedListing);
        
        // Update raw data
        canonicalListing.rawData = scrapedListing;
        
        return canonicalListing;
    }

    /**
     * Create canonical listing from scraped data
     * @param {Object} scrapedListing - Scraped listing data
     * @param {string} source - Source URL/domain
     * @returns {CanonicalListing} New canonical listing
     */
    createCanonicalListing(scrapedListing, source) {
        return new CanonicalListing({
            listingId: scrapedListing.id,
            source,
            title: scrapedListing.title || scrapedListing.description,
            price: scrapedListing.price,
            condition: scrapedListing.condition,
            location: scrapedListing.location,
            url: scrapedListing.url,
            imageUrls: scrapedListing.imageUrls || scrapedListing.image_urls || [],
            rawData: scrapedListing,
            trackedFields: ['title', 'price', 'condition', 'location']
        });
    }
}

module.exports = { DiffEngine };
