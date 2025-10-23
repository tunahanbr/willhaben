const axios = require('axios');
const http = require('http');
const https = require('https');

// Axios Instance with Keep-Alive for webhooks
const axiosInstance = axios.create({
    httpAgent: new http.Agent({ 
        keepAlive: true,
        maxSockets: 5,
        timeout: 10000
    }),
    httpsAgent: new https.Agent({ 
        keepAlive: true,
        maxSockets: 5,
        timeout: 10000
    }),
    timeout: 10000
});

async function sendToWebhook(webhookUrl, changes, jobInfo) {
    if (!webhookUrl) return;
    
    try {
        const payload = {
            timestamp: new Date().toISOString(),
            monitoredUrl: jobInfo.originalUrl,
            changes: changes,
            changesCount: changes.length,
            changesSummary: {
                newListings: changes.filter(c => c.type === 'NEW_LISTING').length,
                removedListings: changes.filter(c => c.type === 'REMOVED_LISTING').length,
                priceChanges: changes.filter(c => c.type === 'PRICE_CHANGE').length,
                descriptionChanges: changes.filter(c => c.type === 'DESCRIPTION_CHANGE').length
            },
            monitoringInfo: {
                checkCount: jobInfo.checkCount,
                lastCheck: jobInfo.lastCheck,
                currentListingsCount: jobInfo.lastSnapshot?.length || 0,
                nextInterval: jobInfo.currentInterval
            }
        };

        await axiosInstance.post(webhookUrl, payload, {
            headers: { 'Content-Type': 'application/json' }
        });
        
        console.log(`[Webhook] Successfully sent ${changes.length} changes to webhook`);
    } catch (error) {
        console.error(`[Webhook] Failed to send:`, error.message);
    }
}

module.exports = {
    sendToWebhook
};