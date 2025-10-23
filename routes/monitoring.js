const express = require('express');
const router = express.Router();
const monitoringController = require('../controllers/monitoring-controller');

// Monitoring endpoints
router.get('/startMonitoring', monitoringController.startMonitoring);
router.get('/stopMonitoring', monitoringController.stopMonitoring);
router.get('/getChanges', monitoringController.getChanges);
router.get('/getMonitoringStatus', monitoringController.getMonitoringStatus);

module.exports = router;