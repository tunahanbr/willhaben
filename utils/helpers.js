const CONFIG = require('../config/constants');

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

module.exports = {
    normalizeUrl,
    formatBytes,
    buildUrlWithPage,
    rebuildUrl,
    setsEqual,
    isPeakHours
};