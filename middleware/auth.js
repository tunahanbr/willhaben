const config = require('../config/config');
const logger = require('../utils/logger');

const validateApiKey = (req, res, next) => {
    const apiKey = req.header('X-API-Key');

    if (!apiKey) {
        logger.warn('API request without key', { ip: req.ip, path: req.path });
        return res.status(401).json({ error: 'API key is required' });
    }

    if (!config.apiKeys.includes(apiKey)) {
        logger.warn('Invalid API key used', { 
            ip: req.ip, 
            path: req.path,
            key: apiKey.substring(0, 4) + '...' // Log only first 4 chars for security
        });
        return res.status(403).json({ error: 'Invalid API key' });
    }

    // Add rate limiting information to request for later use
    req.apiKey = apiKey;
    next();
};

module.exports = validateApiKey;