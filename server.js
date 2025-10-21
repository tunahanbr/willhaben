const express = require('express');
const axios = require('axios');
const cors = require('cors');
const os = require('os');

const app = express();
const PORT = 2456;

app.use(cors());

// === Helper: Convert Bytes to Human-Readable ===
function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(2)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(2)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
}

// === Resource Monitoring Helpers ===
function getSystemSnapshot() {
    const mem = process.memoryUsage();
    return {
        timestamp: new Date().toISOString(),
        cpu: process.cpuUsage(),
        memory: {
            rss: mem.rss,
            heapTotal: mem.heapTotal,
            heapUsed: mem.heapUsed,
            external: mem.external,
            arrayBuffers: mem.arrayBuffers
        },
        system: {
            platform: os.platform(),
            release: os.release(),
            arch: os.arch(),
            cpuCount: os.cpus().length,
            totalMemory: os.totalmem(),
            freeMemory: os.freemem(),
            loadAvg: os.loadavg(),
            uptime: os.uptime()
        }
    };
}

function diffUsage(start, end) {
    const cpuDiffUserMs = (end.cpu.user - start.cpu.user) / 1000;
    const cpuDiffSystemMs = (end.cpu.system - start.cpu.system) / 1000;
    const totalCpuMs = cpuDiffUserMs + cpuDiffSystemMs;

    const memDiff = {
        rss: end.memory.rss - start.memory.rss,
        heapUsed: end.memory.heapUsed - start.memory.heapUsed,
        heapTotal: end.memory.heapTotal - start.memory.heapTotal
    };

    const durationMs = Date.now() - new Date(start.timestamp).getTime();

    return {
        cpu: {
            userMs: cpuDiffUserMs,
            systemMs: cpuDiffSystemMs,
            totalMs: totalCpuMs,
            formatted: `${totalCpuMs.toFixed(2)} ms (user: ${cpuDiffUserMs.toFixed(2)} ms, system: ${cpuDiffSystemMs.toFixed(2)} ms)`
        },
        memory: {
            rss: formatBytes(end.memory.rss),
            heapUsed: formatBytes(end.memory.heapUsed),
            heapTotal: formatBytes(end.memory.heapTotal),
            diffRss: formatBytes(memDiff.rss),
            diffHeapUsed: formatBytes(memDiff.heapUsed),
            diffHeapTotal: formatBytes(memDiff.heapTotal)
        },
        duration: {
            ms: durationMs,
            seconds: (durationMs / 1000).toFixed(2),
            formatted: `${durationMs} ms (${(durationMs / 1000).toFixed(2)} s)`
        }
    };
}

// === User-Agent Pool etc. (unchanged) ===
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function randomDelay(min = 1000, max = 3000) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return delay(ms);
}

// === Scraping Functions (unchanged) ===
async function scrapeWillhabenPage(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const userAgent = getRandomUserAgent();
            const { data: html } = await axios.get(url, {
                headers: { 'User-Agent': userAgent },
                timeout: 15000
            });

            const jsonString = html.substring(
                html.indexOf('<script id="__NEXT_DATA__" type="application/json">') + '<script id="__NEXT_DATA__" type="application/json">'.length,
                html.indexOf('</script>', html.indexOf('<script id="__NEXT_DATA__" type="application/json">'))
            );

            const result = JSON.parse(jsonString);
            const searchResult = result.props.pageProps.searchResult;
            const listings = searchResult.advertSummaryList.advertSummary;

            const formattedListings = listings.map(listing => {
                const formatted = {
                    id: listing.id,
                    description: listing.description,
                    url: `https://www.willhaben.at${listing.contextLinkList.contextLink[0].uri}`,
                    image_urls: []
                };

                if (listing.advertImageList?.advertImage) {
                    formatted.image_urls = listing.advertImageList.advertImage.map(img => img.url);
                }

                listing.attributes.attribute.forEach(element => {
                    const key = element.name.toLowerCase().replace('/', '_');
                    const value = element.values[0];
                    formatted[key] = isNaN(value) ? value : Number(value);
                });

                return formatted;
            });

            return {
                totalListings: searchResult.numFound,
                listingsPerPage: searchResult.rows,
                currentPage: searchResult.page,
                listings: formattedListings
            };
        } catch (error) {
            if (attempt < retries) await delay(Math.min(1000 * Math.pow(2, attempt), 10000));
            else throw new Error(`Failed to scrape after ${retries} attempts: ${error.message}`);
        }
    }
}

async function scrapeAllPages(baseUrl) {
    const allListings = new Map();
    let currentPage = 1;
    let totalPages = null;
    let totalListings = 0;

    while (true) {
        try {
            const pageUrl = buildUrlWithPage(baseUrl, currentPage);
            const pageData = await scrapeWillhabenPage(pageUrl);

            if (currentPage === 1) {
                totalListings = pageData.totalListings;
                const listingsPerPage = pageData.listingsPerPage;
                totalPages = Math.ceil(totalListings / listingsPerPage);
            }

            pageData.listings.forEach(listing => {
                if (!allListings.has(listing.id)) {
                    allListings.set(listing.id, listing);
                }
            });

            if (pageData.listings.length === 0 || (totalPages && currentPage >= totalPages)) break;
            currentPage++;
            await randomDelay();
        } catch (error) {
            if (allListings.size > 0) break;
            else throw error;
        }
    }

    return {
        totalListings,
        scrapedListings: allListings.size,
        pagesScraped: currentPage,
        listings: Array.from(allListings.values())
    };
}

function buildUrlWithPage(baseUrl, pageNumber) {
    const url = new URL(baseUrl);
    url.searchParams.set('page', pageNumber);
    return url.toString();
}
function rebuildUrl(req) {
    const baseUrl = req.query.url;
    const otherParams = [];
    for (const key in req.query) {
        if (key === 'url') continue;
        const encodedKey = encodeURIComponent(key);
        const encodedValue = encodeURIComponent(req.query[key]);
        otherParams.push(`${encodedKey}=${encodedValue}`);
    }
    return baseUrl + (otherParams.length > 0 ? '&' + otherParams.join('&') : '');
}

// === Endpoints with Friendly System Info ===
app.get('/getListings', async (req, res) => {
    const baseUrl = req.query.url;
    if (!baseUrl) return res.status(400).json({ error: 'A "url" query parameter is required.' });

    const fullUrl = rebuildUrl(req);
    const startSnapshot = getSystemSnapshot();

    try {
        const scrapeData = await scrapeWillhabenPage(fullUrl);
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
});

app.get('/getAllListings', async (req, res) => {
    const baseUrl = req.query.url;
    if (!baseUrl) return res.status(400).json({ error: 'A "url" query parameter is required.' });

    const fullUrl = rebuildUrl(req);
    const startSnapshot = getSystemSnapshot();

    try {
        const allData = await scrapeAllPages(fullUrl);
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
});

app.listen(PORT, () => {
    console.log(`Scraper API running at http://localhost:${PORT}`);
    console.log(`Endpoints:`);
    console.log(`  Single page: http://localhost:${PORT}/getListings?url=YOUR_WILLHABEN_URL`);
    console.log(`  All pages:   http://localhost:${PORT}/getAllListings?url=YOUR_WILLHABEN_URL`);
});
