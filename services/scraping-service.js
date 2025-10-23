const axios = require('axios');
const http = require('http');
const https = require('https');
const sessionManager = require('./session-manager');
const browserPool = require('./browser-pool');
const { humanDelay, humanMouseMove, humanScroll, delay } = require('../utils/anti-detection');
const CONFIG = require('../config/constants');

// Axios Instance with Keep-Alive
const axiosInstance = axios.create({
    httpAgent: new http.Agent({ 
        keepAlive: true,
        maxSockets: 10,
        maxFreeSockets: 5,
        timeout: 60000,
        keepAliveMsecs: 30000
    }),
    httpsAgent: new https.Agent({ 
        keepAlive: true,
        maxSockets: 10,
        maxFreeSockets: 5,
        timeout: 60000,
        keepAliveMsecs: 30000
    }),
    timeout: 15000
});

// Scraping mit Headless Browser
async function scrapeWithBrowser(url, session) {
    const browser = await browserPool.acquire();
    let page;
    
    try {
        page = await browser.newPage();
        
        // Anti-Detection: Override navigator properties
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
            });
            
            window.chrome = {
                runtime: {},
            };
            
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
        });
        
        // Session-spezifische Einstellungen
        await page.setUserAgent(session.userAgent);
        await page.setViewport({
            width: parseInt(session.fingerprint.screenResolution.split('x')[0]),
            height: parseInt(session.fingerprint.screenResolution.split('x')[1])
        });
        
        // Extra Headers setzen
        await page.setExtraHTTPHeaders(session.headers);
        
        // Zufällige Verzögerung vor dem Request
        await humanDelay();
        
        // Seite laden
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        // Menschliches Verhalten simulieren
        if (CONFIG.MOUSE_MOVEMENTS) {
            await humanMouseMove(page);
        }
        
        if (CONFIG.RANDOM_SCROLLING) {
            await humanScroll(page);
        }
        
        // Weitere zufällige Verzögerung
        await delay(Math.random() * 1000 + 1000);
        
        // Daten extrahieren
        const jsonData = await page.evaluate(() => {
            const scriptTag = document.querySelector('#__NEXT_DATA__');
            return scriptTag ? JSON.parse(scriptTag.textContent) : null;
        });
        
        if (!jsonData) {
            throw new Error('Could not find __NEXT_DATA__ script tag');
        }
        
        browserPool.release(browser);
        
        return jsonData;
        
    } catch (error) {
        if (page) await page.close();
        browserPool.release(browser);
        throw error;
    }
}

// Scraping mit Axios (klassisch)
async function scrapeWithAxios(url, session, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            // Menschliche Verzögerung vor Request
            await humanDelay();
            
            const headers = {
                ...session.headers,
            };
            
            // Cookies hinzufügen falls vorhanden
            const cookieHeader = session.getCookieHeader();
            if (cookieHeader) {
                headers['Cookie'] = cookieHeader;
            }
            
            // Referer simulieren
            if (Math.random() > 0.5) {
                headers['Referer'] = 'https://www.google.com/';
            }
            
            const response = await axiosInstance.get(url, { headers });
            
            // Cookies aus Response speichern
            session.updateCookies(response.headers['set-cookie']);
            
            const html = response.data;
            const jsonString = html.substring(
                html.indexOf('<script id="__NEXT_DATA__" type="application/json">') + '<script id="__NEXT_DATA__" type="application/json">'.length,
                html.indexOf('</script>', html.indexOf('<script id="__NEXT_DATA__" type="application/json">'))
            );

            return JSON.parse(jsonString);
            
        } catch (error) {
            if (attempt < retries) {
                const backoffDelay = Math.min(1000 * Math.pow(2, attempt), 10000);
                console.log(`[Scraper] Attempt ${attempt} failed, retrying in ${backoffDelay}ms...`);
                await delay(backoffDelay);
            } else {
                throw new Error(`Failed after ${retries} attempts: ${error.message}`);
            }
        }
    }
}

// Unified Scraping Function
async function scrapeWillhabenPage(url, jobUrl, retries = 3) {
    const session = sessionManager.getSession(jobUrl);
    
    let jsonData;
    if (CONFIG.USE_HEADLESS_BROWSER) {
        jsonData = await scrapeWithBrowser(url, session);
    } else {
        jsonData = await scrapeWithAxios(url, session, retries);
    }
    
    const searchResult = jsonData.props.pageProps.searchResult;
    const listings = searchResult.advertSummaryList.advertSummary;

    const formattedListings = listings.map(listing => {
        const formatted = {
            id: listing.id,
            description: listing.description,
            url: null,
            image_urls: []
        };

        if (listing.contextLinkList?.contextLink && listing.contextLinkList.contextLink.length > 0) {
            const webLink = listing.contextLinkList.contextLink.find(link => 
                link.uri && !link.uri.includes('api.willhaben') && !link.uri.includes('/restapi/')
            );
            
            if (webLink) {
                const uri = webLink.uri;
                formatted.url = uri.startsWith('http') ? uri : `https://www.willhaben.at${uri}`;
            } else {
                const slug = listing.description
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, '')
                    .substring(0, 50);
                
                let category = 'kaufen-und-verkaufen';
                
                if (listing.attributes?.attribute) {
                    const categoryAttr = listing.attributes.attribute.find(a => 
                        a.name.toLowerCase().includes('category') || 
                        a.name.toLowerCase().includes('section')
                    );
                    if (categoryAttr?.values?.[0]) {
                        const catValue = categoryAttr.values[0].toLowerCase();
                        if (catValue.includes('immo') || catValue.includes('wohnung') || catValue.includes('haus')) {
                            category = 'immobilien';
                        } else if (catValue.includes('auto') || catValue.includes('fahrzeug')) {
                            category = 'auto';
                        } else if (catValue.includes('job')) {
                            category = 'jobs';
                        }
                    }
                }
                
                formatted.url = `https://www.willhaben.at/iad/${category}/d/${slug}-${listing.id}`;
            }
        }

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
        listings: formattedListings,
        sessionInfo: {
            sessionId: session.id,
            userAgent: session.userAgent.substring(0, 50) + '...',
            browserType: session.browserType,
            requestCount: session.requestCount
        }
    };
}

// Optimized Parallel Scraping
async function scrapeAllPagesParallel(baseUrl, jobUrl, fastMode = false) {
    const allListings = new Map();
    const { buildUrlWithPage, randomDelay } = require('../utils/helpers');
    const { delay } = require('../utils/anti-detection');
    
    // Always scrape first page
    const firstPage = await scrapeWillhabenPage(baseUrl, jobUrl);
    firstPage.listings.forEach(l => allListings.set(l.id, l));
    
    const totalListings = firstPage.totalListings;
    const listingsPerPage = firstPage.listingsPerPage;
    const totalPages = Math.ceil(totalListings / listingsPerPage);
    
    // Fast mode: only first page
    if (fastMode || totalPages === 1) {
        return {
            totalListings,
            scrapedListings: allListings.size,
            pagesScraped: 1,
            listings: Array.from(allListings.values()),
            fastMode,
            sessionInfo: firstPage.sessionInfo
        };
    }
    
    // Scrape remaining pages in parallel batches
    const concurrency = CONFIG.CONCURRENT_PAGES;
    for (let i = 2; i <= totalPages; i += concurrency) {
        const batch = [];
        for (let j = i; j < i + concurrency && j <= totalPages; j++) {
            batch.push(scrapeWillhabenPage(buildUrlWithPage(baseUrl, j), jobUrl));
        }
        
        const results = await Promise.allSettled(batch);
        results.forEach(r => {
            if (r.status === 'fulfilled') {
                r.value.listings.forEach(l => allListings.set(l.id, l));
            }
        });
        
        // Human-like delay between batches
        if (i + concurrency <= totalPages) {
            await randomDelay(2000, 4000);
        }
    }
    
    return {
        totalListings,
        scrapedListings: allListings.size,
        pagesScraped: totalPages,
        listings: Array.from(allListings.values()),
        fastMode: false,
        sessionInfo: firstPage.sessionInfo
    };
}

module.exports = {
    scrapeWillhabenPage,
    scrapeAllPagesParallel
};