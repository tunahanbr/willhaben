const express = require('express');
const cors = require('cors');
const monitoringRoutes = require('./routes/monitoring');
const scrapingRoutes = require('./routes/scraping');
const validateApiKey = require('./middleware/auth');

const app = express();
const PORT = 2456;

app.use(cors());
app.use(express.json());

// Serve static files from the public directory
app.use(express.static('public'));

// Routes
app.use('/api', validateApiKey, monitoringRoutes);
app.use('/api', validateApiKey, scrapingRoutes);

// Cleanup on server shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down gracefully...');
    const monitoringService = require('./services/monitoring-service');
    const browserPool = require('./services/browser-pool');
    
    monitoringService.cleanupAllJobs();
    if (browserPool) {
        await browserPool.cleanup();
    }
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`╔════════════════════════════════════════════════════════════════╗`);
    console.log(`║  Enhanced Willhaben Scraper API - Running on Port ${PORT}     ║`);
    console.log(`╚════════════════════════════════════════════════════════════════╝`);
    console.log(`\n📊 Basic Endpoints:`);
    console.log(`  GET /api/getListings?url=YOUR_URL`);
    console.log(`  GET /api/getAllListings?url=YOUR_URL`);
    console.log(`\n🔄 Monitoring Endpoints:`);
    console.log(`  GET /api/startMonitoring?url=YOUR_URL&webhook=YOUR_WEBHOOK`);
    console.log(`  GET /api/stopMonitoring?url=YOUR_URL`);
    console.log(`  GET /api/getChanges?url=YOUR_URL&clear=true`);
    console.log(`  GET /api/getMonitoringStatus`);
    console.log(`\n🌐 Ready at http://localhost:${PORT}\n`);
});