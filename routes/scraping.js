const express = require('express');
const router = express.Router();
const scrapingController = require('../controllers/scraping-controller');

// Basic scraping endpoints
router.get('/getListings', scrapingController.getListings);
router.get('/getAllListings', scrapingController.getAllListings);

module.exports = router;