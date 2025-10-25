FROM node:20-slim AS builder

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

FROM node:20-slim

# Install dependencies for Puppeteer and networking tools
RUN apt-get update \
    && apt-get install -y chromium \
       chromium-sandbox \
       fonts-ipafont-gothic \
       fonts-wqy-zenhei \
       fonts-thai-tlwg \
       fonts-kacst \
       fonts-freefont-ttf \
       libxss1 \
       net-tools \
       curl \
       --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser

# Set environment variables for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=2456

# Create app directory
WORKDIR /usr/src/app

# Copy from builder stage
COPY --from=builder /usr/src/app .

# Set up public directory
COPY public /usr/src/app/public/

# Verify files exist and are readable
RUN echo "Verifying public files..." && \
    test -f /usr/src/app/public/app.js && \
    test -f /usr/src/app/public/styles.css && \
    test -f /usr/src/app/public/index.html && \
    echo "Files verified successfully" && \
    # Set proper permissions
    chown -R pptruser:pptruser /usr/src/app && \
    chmod -R 755 /usr/src/app/public && \
    find /usr/src/app/public -type f -exec chmod 644 {} \;

# Switch to non-root user
USER pptruser

# Expose port
EXPOSE 2456

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:2456/health || exit 1

# Start the application
CMD ["npm", "start"]