const express = require('express');
const axios = require('axios');
const cors = require('cors');
const os = require('os');
const http = require('http');
const https = require('https');
const puppeteer = require('puppeteer');
const crypto = require('crypto');

const app = express();
const PORT = 2456;

app.use(cors());

// === Configuration ===
const CONFIG = {
    MIN_INTERVAL: 60000,        // 1 minute minimum
    MAX_INTERVAL: 600000,       // 10 minutes maximum
    DEFAULT_INTERVAL: 120000,   // 2 minutes default
    ACTIVE_INTERVAL: 60000,     // 1 minute when changes detected
    QUIET_INTERVAL: 300000,     // 5 minutes when quiet
    CONCURRENT_PAGES: 3,        // Parallel page requests
    CHANGES_RETENTION: 100,
    ACTIVITY_WINDOW: 3600000,   // 1 hour for activity tracking
    PEAK_HOURS_START: 6,        // 6 AM
    PEAK_HOURS_END: 22,         // 10 PM
    
    // Anti-Detection Settings
    USE_HEADLESS_BROWSER: false,  // Toggle headless browser mode
    BROWSER_POOL_SIZE: 2,         // Number of browser instances
    SESSION_ROTATION_INTERVAL: 1800000, // Rotate session every 30 min
    HUMAN_DELAY_MIN: 2000,        // Min delay between actions (ms)
    HUMAN_DELAY_MAX: 5000,        // Max delay between actions (ms)
    MOUSE_MOVEMENTS: true,        // Simulate mouse movements
    RANDOM_SCROLLING: true,       // Random page scrolling
};

// === Erweiterter User-Agent Pool ===
// Realistische User-Agents aus aktuellen Browser-Versionen
const EXTENDED_USER_AGENTS = [
    // Chrome Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    
    // Chrome Mac
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    
    // Firefox Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
    
    // Firefox Mac
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.1; rv:120.0) Gecko/20100101 Firefox/120.0',
    
    // Safari Mac
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    
    // Edge Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    
    // Chrome Linux
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

// Browser-spezifische Header-Profile
const BROWSER_PROFILES = {
    chrome: {
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'accept-language': 'de-AT,de;q=0.9,en-US;q=0.8,en;q=0.7',
        'accept-encoding': 'gzip, deflate, br',
    },
    firefox: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'de-AT,de;q=0.8,en-US;q=0.5,en;q=0.3',
        'accept-encoding': 'gzip, deflate, br',
        'upgrade-insecure-requests': '1',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
        'te': 'trailers',
    },
    safari: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'de-AT,de;q=0.9',
        'accept-encoding': 'gzip, deflate, br',
    }
};

// === Session Management ===
class BrowserSession {
    constructor(id) {
        this.id = id;
        this.userAgent = this.selectUserAgent();
        this.browserType = this.detectBrowserType(this.userAgent);
        this.headers = this.buildHeaders();
        this.cookies = new Map();
        this.createdAt = Date.now();
        this.requestCount = 0;
        this.lastUsed = Date.now();
        
        // Fingerprint-ähnliche Eigenschaften
        this.fingerprint = {
            screenResolution: this.getRandomScreenResolution(),
            timezone: 'Europe/Vienna',
            language: 'de-AT',
            platform: this.getPlatformFromUA(this.userAgent),
            hardwareConcurrency: Math.floor(Math.random() * 8) + 4,
            deviceMemory: [4, 8, 16][Math.floor(Math.random() * 3)],
        };
    }
    
    selectUserAgent() {
        // Gewichtete Auswahl basierend auf Marktanteilen
        const weights = {
            chrome: 0.65,
            firefox: 0.15,
            safari: 0.15,
            edge: 0.05
        };
        
        const rand = Math.random();
        let cumulative = 0;
        let selectedType = 'chrome';
        
        for (const [type, weight] of Object.entries(weights)) {
            cumulative += weight;
            if (rand < cumulative) {
                selectedType = type;
                break;
            }
        }
        
        // Filter UAs nach Browser-Typ
        const filtered = EXTENDED_USER_AGENTS.filter(ua => {
            if (selectedType === 'chrome') return ua.includes('Chrome/') && !ua.includes('Edg/');
            if (selectedType === 'firefox') return ua.includes('Firefox/');
            if (selectedType === 'safari') return ua.includes('Safari/') && !ua.includes('Chrome/');
            if (selectedType === 'edge') return ua.includes('Edg/');
            return false;
        });
        
        return filtered[Math.floor(Math.random() * filtered.length)] || EXTENDED_USER_AGENTS[0];
    }
    
    detectBrowserType(ua) {
        if (ua.includes('Firefox/')) return 'firefox';
        if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'safari';
        if (ua.includes('Edg/')) return 'edge';
        return 'chrome';
    }
    
    buildHeaders() {
        const profile = BROWSER_PROFILES[this.browserType] || BROWSER_PROFILES.chrome;
        return {
            ...profile,
            'User-Agent': this.userAgent,
            'cache-control': 'max-age=0',
            'dnt': '1',
        };
    }
    
    getRandomScreenResolution() {
        const resolutions = [
            '1920x1080', '2560x1440', '1366x768', '1536x864',
            '1440x900', '1680x1050', '3840x2160', '2560x1600'
        ];
        return resolutions[Math.floor(Math.random() * resolutions.length)];
    }
    
    getPlatformFromUA(ua) {
        if (ua.includes('Windows')) return 'Win32';
        if (ua.includes('Macintosh')) return 'MacIntel';
        if (ua.includes('Linux')) return 'Linux x86_64';
        return 'Win32';
    }
    
    updateCookies(setCookieHeaders) {
        if (!setCookieHeaders) return;
        const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
        cookies.forEach(cookie => {
            const [nameValue] = cookie.split(';');
            const [name, value] = nameValue.split('=');
            this.cookies.set(name.trim(), value.trim());
        });
    }
    
    getCookieHeader() {
        return Array.from(this.cookies.entries())
            .map(([name, value]) => `${name}=${value}`)
            .join('; ');
    }
    
    shouldRotate() {
        const age = Date.now() - this.createdAt;
        return age > CONFIG.SESSION_ROTATION_INTERVAL || this.requestCount > 100;
    }
    
    markUsed() {
        this.lastUsed = Date.now();
        this.requestCount++;
    }
}

// Session Pool Management
class SessionManager {
    constructor() {
        this.sessions = new Map();
        this.currentSessionId = null;
    }
    
    getSession(jobUrl) {
        const sessionId = this.generateSessionId(jobUrl);
        
        if (!this.sessions.has(sessionId) || this.sessions.get(sessionId).shouldRotate()) {
            console.log(`[Session] Creating new session for ${sessionId}`);
            this.sessions.set(sessionId, new BrowserSession(sessionId));
        }
        
        const session = this.sessions.get(sessionId);
        session.markUsed();
        return session;
    }
    
    generateSessionId(jobUrl) {
        return crypto.createHash('md5').update(jobUrl).digest('hex').substring(0, 8);
    }
    
    cleanup() {
        const now = Date.now();
        for (const [id, session] of this.sessions.entries()) {
            if (now - session.lastUsed > CONFIG.SESSION_ROTATION_INTERVAL * 2) {
                console.log(`[Session] Cleaning up inactive session ${id}`);
                this.sessions.delete(id);
            }
        }
    }
}

const sessionManager = new SessionManager();

// Cleanup sessions periodically
setInterval(() => sessionManager.cleanup(), CONFIG.SESSION_ROTATION_INTERVAL);

// === Browser Pool (für Headless Mode) ===
class BrowserPool {
    constructor(size) {
        this.size = size;
        this.browsers = [];
        this.available = [];
        this.initialized = false;
    }
    
    async initialize() {
        if (this.initialized) return;
        
        console.log(`[BrowserPool] Initializing ${this.size} browser instances...`);
        
        for (let i = 0; i < this.size; i++) {
            const browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-blink-features=AutomationControlled',
                    '--window-size=1920,1080',
                ],
            });
            
            this.browsers.push(browser);
            this.available.push(browser);
        }
        
        this.initialized = true;
        console.log(`[BrowserPool] Initialized ${this.size} browsers`);
    }
    
    async acquire() {
        if (!this.initialized) await this.initialize();
        
        while (this.available.length === 0) {
            await delay(100);
        }
        
        return this.available.pop();
    }
    
    release(browser) {
        if (!this.available.includes(browser)) {
            this.available.push(browser);
        }
    }
    
    async cleanup() {
        for (const browser of this.browsers) {
            await browser.close();
        }
        this.browsers = [];
        this.available = [];
        this.initialized = false;
    }
}

const browserPool = CONFIG.USE_HEADLESS_BROWSER ? new BrowserPool(CONFIG.BROWSER_POOL_SIZE) : null;

// === Axios Instance with Keep-Alive ===
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

// === Circuit Breaker ===
class CircuitBreaker {
    constructor(threshold = 5, timeout = 60000) {
        this.failures = 0;
        this.threshold = threshold;
        this.timeout = timeout;
        this.state = 'CLOSED';
        this.nextAttempt = Date.now();
        this.successCount = 0;
    }
    
    async execute(fn) {
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                throw new Error(`Circuit breaker OPEN. Retry after ${new Date(this.nextAttempt).toISOString()}`);
            }
            this.state = 'HALF_OPEN';
            this.successCount = 0;
        }
        
        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }
    
    onSuccess() {
        if (this.state === 'HALF_OPEN') {
            this.successCount++;
            if (this.successCount >= 3) {
                this.state = 'CLOSED';
                this.failures = 0;
            }
        } else {
            this.failures = Math.max(0, this.failures - 1);
        }
    }
    
    onFailure() {
        this.failures++;
        this.successCount = 0;
        
        if (this.failures >= this.threshold) {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.timeout;
            console.warn(`[CircuitBreaker] Opening circuit. Failures: ${this.failures}`);
        }
    }
    
    getState() {
        return {
            state: this.state,
            failures: this.failures,
            nextAttempt: this.state === 'OPEN' ? new Date(this.nextAttempt).toISOString() : null
        };
    }
}

// === Monitoring State ===
const monitoringJobs = new Map();
const circuitBreakers = new Map();

// === Human-like Behavior Helpers ===
function delay(ms) { 
    return new Promise(resolve => setTimeout(resolve, ms)); 
}

function randomDelay(min = 500, max = 1500) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return delay(ms);
}

function humanDelay() {
    return randomDelay(CONFIG.HUMAN_DELAY_MIN, CONFIG.HUMAN_DELAY_MAX);
}

// Simuliert menschliche Tippgeschwindigkeit
async function humanType(page, selector, text) {
    await page.click(selector);
    for (const char of text) {
        await page.keyboard.type(char);
        await delay(Math.random() * 100 + 50); // 50-150ms per char
    }
}

// Simuliert Mausbewegungen
async function humanMouseMove(page) {
    const width = 1920;
    const height = 1080;
    
    // Zufällige Mausbewegung
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    
    await page.mouse.move(x, y, { steps: 10 });
    await delay(Math.random() * 500 + 200);
}

// Simuliert Scrolling-Verhalten
async function humanScroll(page) {
    const scrollSteps = Math.floor(Math.random() * 3) + 2; // 2-4 Scrolls
    
    for (let i = 0; i < scrollSteps; i++) {
        const scrollAmount = Math.floor(Math.random() * 500) + 200;
        await page.evaluate((amount) => {
            window.scrollBy(0, amount);
        }, scrollAmount);
        await delay(Math.random() * 1000 + 500);
    }
    
    // Manchmal nach oben scrollen
    if (Math.random() > 0.7) {
        await page.evaluate(() => window.scrollBy(0, -300));
        await delay(Math.random() * 500 + 200);
    }
}

// === Helper Functions ===
function normalizeUrl(url) {
    try {
        const urlObj = new URL(url);
        const params = Array.from(urlObj.searchParams.entries()).sort();
        urlObj.search = '';
        params.forEach(([key, value]) => urlObj.searchParams.append(key, value));
        return urlObj.toString();
    } catch (e) {
        return url;
    }
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(2)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(2)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
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
        if (key === 'url' || key === 'interval' || key === 'clear' || key === 'webhook') continue;
        const encodedKey = encodeURIComponent(key);
        const encodedValue = encodeURIComponent(req.query[key]);
        otherParams.push(`${encodedKey}=${encodedValue}`);
    }
    return baseUrl + (otherParams.length > 0 ? '&' + otherParams.join('&') : '');
}

function setsEqual(set1, set2) {
    if (set1.size !== set2.size) return false;
    for (const item of set1) {
        if (!set2.has(item)) return false;
    }
    return true;
}

function isPeakHours() {
    const hour = new Date().getHours();
    return hour >= CONFIG.PEAK_HOURS_START && hour < CONFIG.PEAK_HOURS_END;
}

// === Adaptive Interval Logic ===
function calculateNextInterval(job) {
    const now = Date.now();
    const recentChanges = job.changes.filter(c => 
        now - new Date(c.timestamp).getTime() < CONFIG.ACTIVITY_WINDOW
    ).length;
    
    let interval;
    if (recentChanges > 5) {
        interval = CONFIG.ACTIVE_INTERVAL;
    } else if (recentChanges > 0) {
        interval = CONFIG.DEFAULT_INTERVAL;
    } else {
        interval = CONFIG.QUIET_INTERVAL;
    }
    
    if (!isPeakHours()) {
        interval = Math.min(interval * 1.5, CONFIG.MAX_INTERVAL);
    }
    
    if (job.consecutiveErrors > 0) {
        const backoffMultiplier = Math.pow(2, Math.min(job.consecutiveErrors, 4));
        interval = Math.min(interval * backoffMultiplier, CONFIG.MAX_INTERVAL);
    }
    
    return Math.max(interval, CONFIG.MIN_INTERVAL);
}

// === Resource Monitoring ===
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
        }
    };
}

function diffUsage(start, end) {
    const cpuDiffUserMs = (end.cpu.user - start.cpu.user) / 1000;
    const cpuDiffSystemMs = (end.cpu.system - start.cpu.system) / 1000;
    const totalCpuMs = cpuDiffUserMs + cpuDiffSystemMs;
    const durationMs = Date.now() - new Date(start.timestamp).getTime();

    return {
        cpu: {
            totalMs: totalCpuMs,
            formatted: `${totalCpuMs.toFixed(2)} ms`
        },
        memory: {
            rss: formatBytes(end.memory.rss),
            heapUsed: formatBytes(end.memory.heapUsed),
            heapTotal: formatBytes(end.memory.heapTotal)
        },
        duration: {
            ms: durationMs,
            formatted: `${(durationMs / 1000).toFixed(2)} s`
        }
    };
}

// === Scraping mit Headless Browser ===
async function scrapeWithBrowser(url, session) {
    const browser = await browserPool.acquire();
    let page;
    
    try {
        page = await browser.newPage();
        
        // Anti-Detection: Override navigator properties
        await page.evaluateOnNewDocument(() => {
            // Webdriver-Flag entfernen
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
            });
            
            // Chrome-Objekt hinzufügen
            window.chrome = {
                runtime: {},
            };
            
            // Permissions API überschreiben
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
        
        // Zufällige Verzögerung vor dem Request (menschliches Verhalten)
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
        await randomDelay(1000, 2000);
        
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

// === Scraping mit Axios (klassisch) ===
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
            
            // Referer simulieren (als ob man von Google kommt)
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

// === Unified Scraping Function ===
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

// === Optimized Parallel Scraping ===
async function scrapeAllPagesParallel(baseUrl, jobUrl, fastMode = false) {
    const allListings = new Map();
    
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

// === Change Detection ===
function detectChanges(oldListings, newListings) {
    const changes = [];
    const oldMap = new Map(oldListings.map(l => [l.id, l]));
    const newMap = new Map(newListings.map(l => [l.id, l]));

    for (const [id, listing] of newMap) {
        if (!oldMap.has(id)) {
            changes.push({
                type: 'NEW_LISTING',
                timestamp: new Date().toISOString(),
                listingId: id,
                listing: listing
            });
        }
    }

    for (const [id, listing] of oldMap) {
        if (!newMap.has(id)) {
            changes.push({
                type: 'REMOVED_LISTING',
                timestamp: new Date().toISOString(),
                listingId: id,
                listing: listing
            });
        }
    }

    for (const [id, newListing] of newMap) {
        if (oldMap.has(id)) {
            const oldListing = oldMap.get(id);
            
            if (oldListing.price !== undefined && newListing.price !== undefined && 
                oldListing.price !== newListing.price) {
                changes.push({
                    type: 'PRICE_CHANGE',
                    timestamp: new Date().toISOString(),
                    listingId: id,
                    listing: newListing,
                    oldPrice: oldListing.price,
                    newPrice: newListing.price,
                    priceChange: newListing.price - oldListing.price
                });
            }

            if (oldListing.description !== newListing.description) {
                changes.push({
                    type: 'DESCRIPTION_CHANGE',
                    timestamp: new Date().toISOString(),
                    listingId: id,
                    listing: newListing,
                    oldDescription: oldListing.description,
                    newDescription: newListing.description
                });
            }
        }
    }

    return changes;
}

// === Webhook ===
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
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
        });
        
        console.log(`[Webhook] Successfully sent ${changes.length} changes to webhook`);
    } catch (error) {
        console.error(`[Webhook] Failed to send:`, error.message);
    }
}

// === Smart Monitoring Check ===
async function performSmartMonitoringCheck(normalizedUrl) {
    const job = monitoringJobs.get(normalizedUrl);
    if (!job) return;

    const breaker = circuitBreakers.get(normalizedUrl);
    
    try {
        await breaker.execute(async () => {
            // Quick check: only first page
            const firstPageData = await scrapeWillhabenPage(job.originalUrl, job.originalUrl);
            const firstPageIds = new Set(firstPageData.listings.map(l => l.id));
            
            let needsFullScrape = false;
            
            if (job.lastSnapshot && job.lastSnapshot.length > 0) {
                const pageSize = firstPageData.listingsPerPage;
                const oldFirstPageIds = new Set(
                    job.lastSnapshot.slice(0, pageSize).map(l => l.id)
                );
                
                needsFullScrape = !setsEqual(firstPageIds, oldFirstPageIds);
            } else {
                needsFullScrape = true;
            }
            
            let newListings;
            let scrapingStats;
            
            if (needsFullScrape) {
                console.log(`[Monitor] Changes detected on first page for ${normalizedUrl}, doing full scrape...`);
                const fullData = await scrapeAllPagesParallel(job.originalUrl, job.originalUrl, false);
                newListings = fullData.listings;
                scrapingStats = {
                    mode: 'full',
                    pagesScraped: fullData.pagesScraped,
                    listingsFound: fullData.scrapedListings,
                    sessionInfo: fullData.sessionInfo
                };
            } else {
                newListings = job.lastSnapshot;
                scrapingStats = {
                    mode: 'fast',
                    pagesScraped: 1,
                    listingsFound: firstPageData.listings.length,
                    sessionInfo: firstPageData.sessionInfo
                };
                console.log(`[Monitor] No changes on first page for ${normalizedUrl}, skipping full scrape`);
            }

            let detectedChanges = [];
            if (job.lastSnapshot && job.lastSnapshot.length > 0 && needsFullScrape) {
                detectedChanges = detectChanges(job.lastSnapshot, newListings);
                
                if (detectedChanges.length > 0) {
                    job.changes.push(...detectedChanges);
                    
                    if (job.webhookUrl) {
                        await sendToWebhook(job.webhookUrl, detectedChanges, job);
                    }
                    
                    if (job.changes.length > CONFIG.CHANGES_RETENTION) {
                        job.changes = job.changes.slice(-CONFIG.CHANGES_RETENTION);
                    }
                    
                    console.log(`[Monitor] Detected ${detectedChanges.length} changes for ${normalizedUrl}`);
                }
            }

            job.lastSnapshot = newListings;
            job.lastCheck = new Date().toISOString();
            job.checkCount = (job.checkCount || 0) + 1;
            job.consecutiveErrors = 0;
            job.lastError = null;
            job.lastScrapingStats = scrapingStats;
            
            const nextInterval = calculateNextInterval(job);
            job.currentInterval = nextInterval;
            
            rescheduleJob(normalizedUrl, nextInterval);
        });
        
    } catch (error) {
        console.error(`[Monitor] Error checking ${normalizedUrl}:`, error.message);
        job.consecutiveErrors = (job.consecutiveErrors || 0) + 1;
        job.lastError = {
            message: error.message,
            timestamp: new Date().toISOString(),
            consecutiveErrors: job.consecutiveErrors
        };
        
        const nextInterval = calculateNextInterval(job);
        job.currentInterval = nextInterval;
        rescheduleJob(normalizedUrl, nextInterval);
    }
}

function rescheduleJob(normalizedUrl, newInterval) {
    const job = monitoringJobs.get(normalizedUrl);
    if (!job) return;
    
    if (job.intervalId) {
        clearInterval(job.intervalId);
    }
    
    job.intervalId = setInterval(() => {
        performSmartMonitoringCheck(normalizedUrl);
    }, newInterval);
}

// === Endpoints ===
app.get('/getListings', async (req, res) => {
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
});

app.get('/getAllListings', async (req, res) => {
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
});

app.get('/startMonitoring', async (req, res) => {
    const baseUrl = req.query.url;
    const intervalMinutes = parseInt(req.query.interval) || null;
    const webhookUrl = req.query.webhook || null;
    
    if (!baseUrl) {
        return res.status(400).json({ error: 'A "url" query parameter is required.' });
    }

    const fullUrl = rebuildUrl(req);
    const normalizedUrl = normalizeUrl(fullUrl);

    if (monitoringJobs.has(normalizedUrl)) {
        const oldJob = monitoringJobs.get(normalizedUrl);
        clearInterval(oldJob.intervalId);
    }

    if (!circuitBreakers.has(normalizedUrl)) {
        circuitBreakers.set(normalizedUrl, new CircuitBreaker(5, 60000));
    }

    const initialInterval = intervalMinutes 
        ? Math.max(intervalMinutes * 60 * 1000, CONFIG.MIN_INTERVAL)
        : CONFIG.DEFAULT_INTERVAL;

    const job = {
        originalUrl: fullUrl,
        normalizedUrl: normalizedUrl,
        webhookUrl: webhookUrl,
        currentInterval: initialInterval,
        lastSnapshot: [],
        changes: [],
        startedAt: new Date().toISOString(),
        lastCheck: null,
        checkCount: 0,
        consecutiveErrors: 0,
        lastError: null,
        lastScrapingStats: null,
        intervalId: null
    };

    monitoringJobs.set(normalizedUrl, job);

    try {
        await performSmartMonitoringCheck(normalizedUrl);
        
        const nextCheckTime = new Date(Date.now() + job.currentInterval).toISOString();

        res.status(200).json({
            message: 'Monitoring started successfully',
            normalizedUrl: normalizedUrl,
            webhookUrl: webhookUrl || 'Not configured',
            checkInterval: `${(job.currentInterval / 60000).toFixed(1)} minutes (adaptive)`,
            initialListings: job.lastSnapshot?.length || 0,
            nextCheck: nextCheckTime,
            configuration: {
                minInterval: `${CONFIG.MIN_INTERVAL / 60000} minutes`,
                maxInterval: `${CONFIG.MAX_INTERVAL / 60000} minutes`,
                adaptiveMode: 'enabled',
                peakHours: `${CONFIG.PEAK_HOURS_START}:00 - ${CONFIG.PEAK_HOURS_END}:00`,
                headlessBrowser: CONFIG.USE_HEADLESS_BROWSER,
                sessionManagement: 'enabled',
                humanBehavior: 'enabled'
            }
        });
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to start monitoring',
            details: error.message 
        });
    }
});

app.get('/stopMonitoring', (req, res) => {
    const baseUrl = req.query.url;
    
    if (!baseUrl) {
        return res.status(400).json({ error: 'A "url" query parameter is required.' });
    }

    const fullUrl = rebuildUrl(req);
    const normalizedUrl = normalizeUrl(fullUrl);

    if (!monitoringJobs.has(normalizedUrl)) {
        return res.status(404).json({ 
            error: 'No monitoring job found for this URL',
            normalizedUrl: normalizedUrl,
            availableJobs: Array.from(monitoringJobs.keys())
        });
    }

    const job = monitoringJobs.get(normalizedUrl);
    clearInterval(job.intervalId);
    monitoringJobs.delete(normalizedUrl);
    circuitBreakers.delete(normalizedUrl);

    res.status(200).json({
        message: 'Monitoring stopped successfully',
        normalizedUrl: normalizedUrl,
        totalChecks: job.checkCount,
        totalChangesDetected: job.changes.length
    });
});

app.get('/getChanges', (req, res) => {
    const baseUrl = req.query.url;
    const clearAfterRead = req.query.clear === 'true';
    
    if (!baseUrl) {
        return res.status(400).json({ error: 'A "url" query parameter is required.' });
    }

    const fullUrl = rebuildUrl(req);
    const normalizedUrl = normalizeUrl(fullUrl);

    if (!monitoringJobs.has(normalizedUrl)) {
        return res.status(404).json({ 
            error: 'No monitoring job found for this URL',
            requestedUrl: fullUrl,
            normalizedUrl: normalizedUrl,
            availableJobs: Array.from(monitoringJobs.keys())
        });
    }

    const job = monitoringJobs.get(normalizedUrl);
    const breaker = circuitBreakers.get(normalizedUrl);
    const changes = [...job.changes];
    
    if (clearAfterRead) {
        job.changes = [];
    }

    res.status(200).json({
        normalizedUrl: normalizedUrl,
        monitoringStatus: {
            startedAt: job.startedAt,
            lastCheck: job.lastCheck,
            checkCount: job.checkCount,
            currentInterval: `${(job.currentInterval / 60000).toFixed(1)} minutes`,
            currentListingsCount: job.lastSnapshot?.length || 0,
            consecutiveErrors: job.consecutiveErrors,
            lastError: job.lastError,
            webhookUrl: job.webhookUrl || 'Not configured',
            lastScrapingStats: job.lastScrapingStats,
            circuitBreaker: breaker ? breaker.getState() : null
        },
        changes: changes,
        changesCount: changes.length
    });
});

app.get('/getMonitoringStatus', (req, res) => {
    const activeJobs = [];

    for (const [url, job] of monitoringJobs) {
        const breaker = circuitBreakers.get(url);
        activeJobs.push({
            normalizedUrl: url,
            originalUrl: job.originalUrl,
            webhookUrl: job.webhookUrl || 'Not configured',
            startedAt: job.startedAt,
            lastCheck: job.lastCheck,
            checkCount: job.checkCount,
            currentInterval: `${(job.currentInterval / 60000).toFixed(1)} minutes`,
            currentListingsCount: job.lastSnapshot?.length || 0,
            pendingChanges: job.changes.length,
            consecutiveErrors: job.consecutiveErrors,
            lastError: job.lastError,
            lastScrapingStats: job.lastScrapingStats,
            circuitBreaker: breaker ? breaker.getState() : null,
            nextCheck: new Date(Date.now() + job.currentInterval).toISOString()
        });
    }

    res.status(200).json({
        activeMonitors: activeJobs.length,
        activeSessions: sessionManager.sessions.size,
        jobs: activeJobs,
        configuration: {
            minInterval: `${CONFIG.MIN_INTERVAL / 60000} minutes`,
            maxInterval: `${CONFIG.MAX_INTERVAL / 60000} minutes`,
            defaultInterval: `${CONFIG.DEFAULT_INTERVAL / 60000} minutes`,
            concurrentPages: CONFIG.CONCURRENT_PAGES,
            peakHours: `${CONFIG.PEAK_HOURS_START}:00 - ${CONFIG.PEAK_HOURS_END}:00`,
            isPeakHours: isPeakHours(),
            headlessBrowser: CONFIG.USE_HEADLESS_BROWSER,
            browserPoolSize: CONFIG.BROWSER_POOL_SIZE,
            sessionRotationInterval: `${CONFIG.SESSION_ROTATION_INTERVAL / 60000} minutes`,
            humanBehaviorSimulation: {
                mouseMovements: CONFIG.MOUSE_MOVEMENTS,
                randomScrolling: CONFIG.RANDOM_SCROLLING,
                delayRange: `${CONFIG.HUMAN_DELAY_MIN}-${CONFIG.HUMAN_DELAY_MAX}ms`
            }
        }
    });
});

// Cleanup on server shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down gracefully...');
    for (const [url, job] of monitoringJobs) {
        clearInterval(job.intervalId);
    }
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
    console.log(`  GET /getListings?url=YOUR_URL`);
    console.log(`  GET /getAllListings?url=YOUR_URL`);
    console.log(`\n🔄 Monitoring Endpoints:`);
    console.log(`  GET /startMonitoring?url=YOUR_URL&webhook=YOUR_WEBHOOK`);
    console.log(`  GET /stopMonitoring?url=YOUR_URL`);
    console.log(`  GET /getChanges?url=YOUR_URL&clear=true`);
    console.log(`  GET /getMonitoringStatus`);
    console.log(`\n⚡ Optimizations Enabled:`);
    console.log(`  ✓ Adaptive intervals (${CONFIG.MIN_INTERVAL/60000}-${CONFIG.MAX_INTERVAL/60000} min)`);
    console.log(`  ✓ Smart first-page checking`);
    console.log(`  ✓ Parallel page scraping (${CONFIG.CONCURRENT_PAGES} concurrent)`);
    console.log(`  ✓ Circuit breaker pattern`);
    console.log(`  ✓ HTTP keep-alive connections`);
    console.log(`  ✓ Peak hours awareness (${CONFIG.PEAK_HOURS_START}:00-${CONFIG.PEAK_HOURS_END}:00)`);
    console.log(`\n🛡️  Anti-Detection Features:`);
    console.log(`  ✓ Headless browser mode: ${CONFIG.USE_HEADLESS_BROWSER ? 'ENABLED' : 'DISABLED'}`);
    console.log(`  ✓ Extended user-agent pool (${EXTENDED_USER_AGENTS.length} variants)`);
    console.log(`  ✓ Browser-specific header profiles`);
    console.log(`  ✓ Session management with rotation`);
    console.log(`  ✓ Human behavior simulation (delays, scrolling, mouse)`);
    console.log(`  ✓ Cookie persistence per session`);
    console.log(`  ✓ Browser fingerprint randomization`);
    console.log(`\n🌐 Ready at http://localhost:${PORT}\n`);
});