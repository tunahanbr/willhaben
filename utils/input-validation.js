const validator = require('validator');
const { URL } = require('url');

const inputValidation = {
    validateUrl(url) {
        try {
            new URL(url);
            return validator.isURL(url, {
                protocols: ['http', 'https'],
                require_protocol: true,
                require_valid_protocol: true,
                disallow_auth: true
            });
        } catch (e) {
            return false;
        }
    },

    validateWebhookUrl(url) {
        if (!this.validateUrl(url)) return false;
        
        try {
            const parsedUrl = new URL(url);
            // Only allow https for webhooks in production
            if (process.env.NODE_ENV === 'production' && parsedUrl.protocol !== 'https:') {
                return false;
            }
            // Prevent localhost in production
            if (process.env.NODE_ENV === 'production' && 
                (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1')) {
                return false;
            }
            return true;
        } catch (e) {
            return false;
        }
    },

    sanitizeInput(input) {
        if (typeof input !== 'string') return '';
        return validator.escape(input.trim());
    },

    validateApiKey(apiKey) {
        if (typeof apiKey !== 'string') return false;
        // Ensure API key matches expected format (alphanumeric, certain length)
        return validator.isLength(apiKey, { min: 32, max: 64 }) && 
               validator.isAlphanumeric(apiKey);
    }
};

module.exports = inputValidation;