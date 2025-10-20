const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = 2456;

app.use(cors());

// User-Agent Pool für Rotation
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// Zufälligen User-Agent auswählen
function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Verzögerung zwischen Requests
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Zufällige Verzögerung zwischen min und max ms
function randomDelay(min = 1000, max = 3000) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return delay(ms);
}

// Einzelne Seite scrapen
async function scrapeWillhabenPage(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            // Zufälligen User-Agent verwenden
            const userAgent = getRandomUserAgent();
            
            const { data: html } = await axios.get(url, {
                headers: {
                    'User-Agent': userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Cache-Control': 'max-age=0'
                },
                timeout: 15000
            });

            const jsonString = html.substring(
                html.indexOf('<script id="__NEXT_DATA__" type="application/json">') + '<script id="__NEXT_DATA__" type="application/json">'.length,
                html.indexOf('</script>', html.indexOf('<script id="__NEXT_DATA__" type="application/json">'))
            );
            
            const result = JSON.parse(jsonString);
            const searchResult = result.props.pageProps.searchResult;
            const listings = searchResult.advertSummaryList.advertSummary;

            const formattedListings = [];

            listings.forEach(listing => {
                const formatted = {
                    id: listing.id,
                    description: listing.description,
                    url: `https://www.willhaben.at${listing.contextLinkList.contextLink[0].uri}`,
                    image_urls: [],
                };

                if (listing.advertImageList && listing.advertImageList.advertImage) {
                    formatted.image_urls = listing.advertImageList.advertImage.map(img => img.url);
                }

                listing.attributes.attribute.forEach(element => {
                    const key = element.name.toLowerCase().replace('/', '_');
                    const value = element.values[0];
                    formatted[key] = isNaN(value) ? value : Number(value);
                });

                formattedListings.push(formatted);
            });

            return {
                totalListings: searchResult.numFound,
                listingsPerPage: searchResult.rows,
                currentPage: searchResult.page,
                listings: formattedListings,
            };

        } catch (error) {
            console.error(`Attempt ${attempt}/${retries} failed:`, error.message);
            
            if (attempt < retries) {
                // Exponential Backoff bei Fehlern
                const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
                console.log(`Waiting ${waitTime}ms before retry...`);
                await delay(waitTime);
            } else {
                throw new Error(`Failed to scrape after ${retries} attempts: ${error.message}`);
            }
        }
    }
}

// Multi-Page Scraping
async function scrapeAllPages(baseUrl) {
    const allListings = new Map(); // Map für Duplikat-Vermeidung (key = listing.id)
    let currentPage = 1;
    let totalPages = null;
    let totalListings = 0;
    let scrapedCount = 0;

    console.log('Starting multi-page scrape...');

    while (true) {
        try {
            // URL für aktuelle Seite erstellen
            const pageUrl = buildUrlWithPage(baseUrl, currentPage);
            console.log(`\nScraping page ${currentPage}...`);
            console.log(`URL: ${pageUrl}`);

            // Seite scrapen
            const pageData = await scrapeWillhabenPage(pageUrl);
            
            // Erste Seite: Total-Info speichern
            if (currentPage === 1) {
                totalListings = pageData.totalListings;
                const listingsPerPage = pageData.listingsPerPage;
                totalPages = Math.ceil(totalListings / listingsPerPage);
                console.log(`\nTotal listings found: ${totalListings}`);
                console.log(`Pages to scrape: ${totalPages}`);
            }

            // Listings zur Map hinzufügen (verhindert Duplikate)
            let newListings = 0;
            pageData.listings.forEach(listing => {
                if (!allListings.has(listing.id)) {
                    allListings.set(listing.id, listing);
                    newListings++;
                }
            });

            scrapedCount += newListings;
            console.log(`New listings on this page: ${newListings}`);
            console.log(`Total unique listings so far: ${allListings.size}`);

            // Prüfen ob wir fertig sind
            if (pageData.listings.length === 0) {
                console.log('\nNo more listings found. Stopping.');
                break;
            }

            // Prüfen ob wir alle Seiten haben
            if (totalPages && currentPage >= totalPages) {
                console.log('\nReached last page. Stopping.');
                break;
            }

            // Nächste Seite
            currentPage++;

            // Zufällige Verzögerung zwischen Seiten (1-3 Sekunden)
            const delayTime = Math.floor(Math.random() * 2000) + 1000;
            console.log(`Waiting ${delayTime}ms before next page...`);
            await delay(delayTime);

        } catch (error) {
            console.error(`Error on page ${currentPage}:`, error.message);
            
            // Bei Fehler: Prüfen ob wir schon genug haben
            if (allListings.size > 0) {
                console.log(`Stopping due to error, but returning ${allListings.size} listings collected so far.`);
                break;
            } else {
                throw error;
            }
        }
    }

    return {
        totalListings: totalListings,
        scrapedListings: allListings.size,
        pagesScraped: currentPage,
        listings: Array.from(allListings.values())
    };
}

// URL mit Seitenzahl erstellen
function buildUrlWithPage(baseUrl, pageNumber) {
    const url = new URL(baseUrl);
    url.searchParams.set('page', pageNumber);
    return url.toString();
}

// Rebuild URL aus Query-Parametern
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

// Single Page Endpoint (alte Funktionalität)
app.get('/getListings', async (req, res) => {
    const baseUrl = req.query.url;

    if (!baseUrl) {
        return res.status(400).json({ error: 'A "url" query parameter is required.' });
    }

    const fullUrl = rebuildUrl(req);
    console.log('Reconstructed URL:', fullUrl);

    try {
        const scrapeData = await scrapeWillhabenPage(fullUrl);
        res.status(200).json(scrapeData);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Multi-Page Endpoint (NEUE FUNKTIONALITÄT)
app.get('/getAllListings', async (req, res) => {
    const baseUrl = req.query.url;

    if (!baseUrl) {
        return res.status(400).json({ error: 'A "url" query parameter is required.' });
    }

    const fullUrl = rebuildUrl(req);
    console.log('Starting multi-page scrape for URL:', fullUrl);

    try {
        const allData = await scrapeAllPages(fullUrl);
        
        console.log('\n=== SCRAPING COMPLETE ===');
        console.log(`Total unique listings: ${allData.scrapedListings}`);
        console.log(`Pages scraped: ${allData.pagesScraped}`);
        
        res.status(200).json(allData);
    } catch (error) {
        console.error('Multi-page scraping failed:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Scraper API running at http://localhost:${PORT}`);
    console.log(`\nEndpoints:`);
    console.log(`  Single page: http://localhost:${PORT}/getListings?url=YOUR_WILLHABEN_URL`);
    console.log(`  All pages:   http://localhost:${PORT}/getAllListings?url=YOUR_WILLHABEN_URL`);
});