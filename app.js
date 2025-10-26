require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const config = require('./config/config');
const logger = require('./utils/logger');
const monitoringRoutes = require('./routes/monitoring');
const scrapingRoutes = require('./routes/scraping');
const validateApiKey = require('./middleware/auth');
const errorHandler = require('./middleware/error-handler');

const app = express();

// Disable helmet CSP completely for development
app.use((req, res, next) => {
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('X-Content-Security-Policy');
    next();
});

// Security middleware - CSP disabled
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false
}));

// Configure CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization'],
    credentials: false
}));

// Force HTTP for development
app.use((req, res, next) => {
    if (req.secure) {
        res.redirect('http://' + req.headers.host + req.url);
    } else {
        next();
    }
});

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

// Debug middleware to log all requests
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

// Serve static files with simple configuration
app.use(express.static(path.join(__dirname, 'public'), {
    dotfiles: 'deny',
    index: false,
    setHeaders: (res, filepath) => {
        res.set('Cache-Control', 'no-store');
        
        if (filepath.endsWith('.js')) {
            res.set('Content-Type', 'application/javascript; charset=UTF-8');
        } else if (filepath.endsWith('.css')) {
            res.set('Content-Type', 'text/css; charset=UTF-8');
        } else if (filepath.endsWith('.html')) {
            res.set('Content-Type', 'text/html; charset=UTF-8');
        }
    }
}));

// Serve index.html for the root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve auth.html for /auth path
app.get('/auth', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'auth.html'));
});

// Enable CORS for all routes
app.use(cors());

// Apply rate limiting to all API routes
app.use('/api', limiter);

// Routes with API key validation
app.use('/api', validateApiKey, monitoringRoutes);
app.use('/api', validateApiKey, scrapingRoutes);

// Error handling middleware
app.use(errorHandler);

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

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
const host = process.env.HOST || '0.0.0.0';
const server = app.listen(config.port, host, () => {
    logger.info(`╔════════════════════════════════════════════════════════════════╗`);
    logger.info(`║  Enhanced Willhaben Scraper API - Running on ${host}:${config.port}     ║`);
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