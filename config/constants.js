module.exports = {
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
    USE_HEADLESS_BROWSER: false,
    BROWSER_POOL_SIZE: 2,
    SESSION_ROTATION_INTERVAL: 1800000, // Rotate session every 30 min
    HUMAN_DELAY_MIN: 2000,        // Min delay between actions (ms)
    HUMAN_DELAY_MAX: 5000,        // Max delay between actions (ms)
    MOUSE_MOVEMENTS: true,        // Simulate mouse movements
    RANDOM_SCROLLING: true,       // Random page scrolling
};