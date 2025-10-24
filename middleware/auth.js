const validApiKeys = require('../config/api-keys');

const validateApiKey = (req, res, next) => {
    const apiKey = req.header('X-API-Key');

    if (!apiKey) {
        return res.status(401).json({ error: 'API key is required' });
    }

    if (!validApiKeys.has(apiKey)) {
        return res.status(403).json({ error: 'Invalid API key' });
    }

    next();
};

module.exports = validateApiKey;