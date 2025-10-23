const CONFIG = require('../config/constants');

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

module.exports = {
    delay,
    randomDelay,
    humanDelay,
    humanType,
    humanMouseMove,
    humanScroll
};