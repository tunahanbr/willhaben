const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
    logger.error('Unhandled error', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });

    // Don't leak error details in production
    const isProduction = process.env.NODE_ENV === 'production';
    
    res.status(err.status || 500).json({
        error: {
            message: isProduction ? 'Internal server error' : err.message,
            status: err.status || 500
        }
    });
};

module.exports = errorHandler;