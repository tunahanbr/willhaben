const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class PersistenceManager {
    constructor() {
        this.db = new sqlite3.Database(path.join(__dirname, '../data/monitors.db'));
        this.initialized = this.init();
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.db.run(`
                CREATE TABLE IF NOT EXISTS monitors (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    url TEXT NOT NULL,
                    config TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async saveMonitor(url, config) {
        await this.initialized;
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare('INSERT INTO monitors (url, config) VALUES (?, ?)');
            stmt.run(url, JSON.stringify(config), (err) => {
                if (err) reject(err);
                else resolve();
            });
            stmt.finalize();
        });
    }

    async getMonitors() {
        await this.initialized;
        return new Promise((resolve, reject) => {
            this.db.all('SELECT url, config FROM monitors', (err, rows) => {
                if (err) reject(err);
                else {
                    // Transform the rows back to the original format
                    const monitors = rows.map(row => [
                        row.url,
                        JSON.parse(row.config)
                    ]);
                    resolve(monitors);
                }
            });
        });
    }

    async updateMonitor(url, config) {
        await this.initialized;
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare('UPDATE monitors SET config = ? WHERE url = ?');
            stmt.run(JSON.stringify(config), url, (err) => {
                if (err) reject(err);
                else resolve();
            });
            stmt.finalize();
        });
    }

    async deleteMonitor(url) {
        await this.initialized;
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare('DELETE FROM monitors WHERE url = ?');
            stmt.run(url, (err) => {
                if (err) reject(err);
                else resolve();
            });
            stmt.finalize();
        });
    }

    close() {
        this.db.close();
    }
}

module.exports = new PersistenceManager();