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

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,  // Disable CSP temporarily for debugging
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "unsafe-none" }
}));

// Add custom security headers
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    next();
});
app.use(cors({
    origin: function(origin, callback) {
        callback(null, true);  // allow all origins
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization'],
    credentials: true,
    preflightContinue: true,
    optionsSuccessStatus: 204
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

// Debug middleware to log all requests
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Serve static files with specific configuration for each type
app.get('/app.js', (req, res) => {
    console.log('Serving app.js...');
    const filePath = path.join(__dirname, 'public', 'app.js');
    console.log('File path:', filePath);
    
    if (!fs.existsSync(filePath)) {
        console.error('app.js not found at:', filePath);
        return res.status(404).send('File not found');
    }

    res.set({
        'Content-Type': 'text/javascript; charset=UTF-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
    });
    res.sendFile(filePath);
});

app.get('/styles.css', (req, res) => {
    console.log('Serving styles.css...');
    const filePath = path.join(__dirname, 'public', 'styles.css');
    console.log('File path:', filePath);

    if (!fs.existsSync(filePath)) {
        console.error('styles.css not found at:', filePath);
        return res.status(404).send('File not found');
    }

    res.set({
        'Content-Type': 'text/css; charset=UTF-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
    });
    res.sendFile(filePath);
});

// Static file serving for other files
app.use(express.static(path.join(__dirname, 'public'), {
    index: false,  // Disable automatic index serving
    dotfiles: 'deny',
    etag: false,
    lastModified: false,
    setHeaders: (res, filepath) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');
        
        if (filepath.endsWith('.html')) {
            res.set('Content-Type', 'text/html; charset=UTF-8');
            res.set('X-Frame-Options', 'DENY');
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

// Handle OPTIONS requests
app.options('*', cors());

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