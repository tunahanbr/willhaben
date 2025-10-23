const crypto = require('crypto');
const { EXTENDED_USER_AGENTS, BROWSER_PROFILES } = require('../config/browser-profiles');
const CONFIG = require('../config/constants');

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

module.exports = sessionManager;