const puppeteer = require('puppeteer');
const CONFIG = require('../config/constants');

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
            await this.delay(100);
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
    
    delay(ms) { 
        return new Promise(resolve => setTimeout(resolve, ms)); 
    }
}

// Only create browser pool if headless browser is enabled
const browserPool = CONFIG.USE_HEADLESS_BROWSER ? new BrowserPool(CONFIG.BROWSER_POOL_SIZE) : null;

module.exports = browserPool;