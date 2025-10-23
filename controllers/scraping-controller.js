const { scrapeWillhabenPage, scrapeAllPagesParallel } = require('../services/scraping-service');
const { rebuildUrl } = require('../utils/helpers');
const { getSystemSnapshot, diffUsage } = require('../utils/system-monitor');

async function getListings(req, res) {
    const baseUrl = req.query.url;
    if (!baseUrl) return res.status(400).json({ error: 'A "url" query parameter is required.' });

    const fullUrl = rebuildUrl(req);
    const startSnapshot = getSystemSnapshot();

    try {
        const scrapeData = await scrapeWillhabenPage(fullUrl, fullUrl);
        const endSnapshot = getSystemSnapshot();
        const usage = diffUsage(startSnapshot, endSnapshot);

        res.status(200).json({
            ...scrapeData,
            systemInfo: {
                started: startSnapshot.timestamp,
                finished: endSnapshot.timestamp,
                usage
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

async function getAllListings(req, res) {
    const baseUrl = req.query.url;
    if (!baseUrl) return res.status(400).json({ error: 'A "url" query parameter is required.' });

    const fullUrl = rebuildUrl(req);
    const startSnapshot = getSystemSnapshot();

    try {
        const allData = await scrapeAllPagesParallel(fullUrl, fullUrl, false);
        const endSnapshot = getSystemSnapshot();
        const usage = diffUsage(startSnapshot, endSnapshot);

        res.status(200).json({
            ...allData,
            systemInfo: {
                started: startSnapshot.timestamp,
                finished: endSnapshot.timestamp,
                usage
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

module.exports = {
    getListings,
    getAllListings
};