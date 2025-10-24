require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const path = require('path');

const config = require('./config/config');
const logger = require('./utils/logger');
const monitoringRoutes = require('./routes/monitoring');
const scrapingRoutes = require('./routes/scraping');
const validateApiKey = require('./middleware/auth');
const errorHandler = require('./middleware/error-handler');

const app = express();

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'sha256-ieoeWczDHkReVBsRBqaal5AFMlBtNjMzgwKvLqi/tSU='",
                "'sha256-C1S0qJkjGxUxUyPdPD2LcNiSsSsyJcgoLcxJD3Nc0BE='"
            ],
            styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            connectSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            manifestSrc: ["'self'"],
            formAction: ["'self'"],
            baseUri: ["'self'"],
        }
    }
}));
app.use(cors({
    origin: config.allowedOrigins,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-API-Key']
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: config.maxRequestsPerMinute,
    message: 'Too many requests from this IP, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});

// Logging
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

app.use(express.json({ limit: '10kb' })); // Limit payload size
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Serve static files from the public directory with security headers
app.use(express.static('public', {
    setHeaders: (res, path, stat) => {
        res.set('X-Content-Type-Options', 'nosniff');
        if (path.endsWith('.html')) {
            res.set('X-Frame-Options', 'DENY');
        }
    }
}));

// Apply rate limiting to all API routes
app.use('/api', limiter);

// Routes with API key validation
app.use('/api', validateApiKey, monitoringRoutes);
app.use('/api', validateApiKey, scrapingRoutes);

// Error handling middleware
app.use(errorHandler);

// Handle 404s
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    
    const monitoringService = require('./services/monitoring-service');
    const browserPool = require('./services/browser-pool');
    
    try {
        await monitoringService.cleanupAllJobs();
        if (browserPool) {
            await browserPool.cleanup();
        }
        logger.info('Cleanup completed successfully');
        process.exit(0);
    } catch (error) {
        logger.error('Error during cleanup', { error });
        process.exit(1);
    }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
const server = app.listen(config.port, () => {
    logger.info(`╔════════════════════════════════════════════════════════════════╗`);
    logger.info(`║  Enhanced Willhaben Scraper API - Running on Port ${config.port}     ║`);
    logger.info(`║  Environment: ${config.env}                                    ║`);
    logger.info(`╚════════════════════════════════════════════════════════════════╝`);
    
    logger.info('📊 Basic Endpoints:');
    logger.info('  GET /api/getListings?url=YOUR_URL');
    logger.info('  GET /api/getAllListings?url=YOUR_URL');
    
    logger.info('🔄 Monitoring Endpoints:');
    logger.info('  GET /api/startMonitoring?url=YOUR_URL&webhook=YOUR_WEBHOOK');
    logger.info('  GET /api/stopMonitoring?url=YOUR_URL');
    logger.info('  GET /api/getChanges?url=YOUR_URL&clear=true');
    logger.info('  GET /api/getMonitoringStatus');
    
    logger.info(`🌐 Server ready in ${config.env} mode`);
});