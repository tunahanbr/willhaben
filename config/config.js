require('dotenv').config();

const config = {
    env: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 2456,
    apiKeys: (process.env.API_KEYS || '').split(','),
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(','),
    logLevel: process.env.LOG_LEVEL || 'info',
    maxRequestsPerMinute: parseInt(process.env.MAX_REQUESTS_PER_MINUTE, 10) || 100,
    security: {
        enableHttpsOnly: process.env.NODE_ENV === 'production',
        enableHSTS: process.env.NODE_ENV === 'production',
    }
};

module.exports = config;