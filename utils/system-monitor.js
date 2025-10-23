const { formatBytes } = require('./helpers');

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

module.exports = {
    getSystemSnapshot,
    diffUsage
};