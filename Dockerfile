FROM node:20-alpine

# Install sqlite3 runtime deps
RUN apk add --no-cache python3 make g++ sqlite-libs

WORKDIR /app

# Install prod dependencies first (better layer cache)
COPY package.json package-lock.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy source
COPY . .

# Environment
ENV NODE_ENV=production \
    PORT=2456 \
    ADMIN_PORT=3001 \
    REDIS_HOST=redis \
    REDIS_PORT=6379 \
    REDIS_DB=0 \
    SQLITE_PATH=/data/listener.db \
    ENABLE_METRICS=true \
    LOG_LEVEL=info

# Create data and logs dirs (mounted as volumes)
RUN mkdir -p /data /logs
VOLUME ["/data", "/logs"]

EXPOSE 2456 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:2456/listener/health || exit 1

CMD ["node", "server.js"]


