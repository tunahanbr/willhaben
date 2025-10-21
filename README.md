# Willhaben Listener System

A robust, scalable web scraper listener system that monitors Willhaben listings for changes and emits real-time notifications. Built with Node.js, Redis, SQLite, and comprehensive monitoring.

## 🚀 Features

- **Intelligent Polling**: Adaptive polling intervals based on change frequency
- **Change Detection**: Sophisticated diff engine that detects new, updated, and removed listings
- **Event-Driven Architecture**: Reliable event processing with outbox pattern
- **Multiple Notification Channels**: Webhooks, WebSockets, email support
- **Circuit Breakers**: Automatic failure handling and recovery
- **Comprehensive Monitoring**: Prometheus metrics, structured logging, health checks
- **Admin API**: Full management interface for targets and subscribers
- **Fault Tolerance**: Graceful degradation and automatic recovery
- **Scalable Design**: Horizontal scaling support with Redis and stateless workers

## 📋 Prerequisites

- Node.js 16+ 
- Redis server
- SQLite3

## 🛠️ Installation

1. **Clone and install dependencies:**
```bash
git clone <repository-url>
cd willhaben
npm install
```

2. **Start Redis server:**
```bash
# Using Docker
docker run -d --name redis -p 6379:6379 redis:alpine

# Or install locally
# macOS: brew install redis && brew services start redis
# Ubuntu: sudo apt install redis-server && sudo systemctl start redis
```

3. **Create data directory:**
```bash
mkdir -p data logs
```

4. **Start the system:**
```bash
npm start
```

## 🐳 Run with Docker & Docker Compose

### 1. Build and start
```bash
docker-compose up -d --build
```

This starts:
- `app` at `http://localhost:2456` and admin API at `http://localhost:3001/api/admin`
- `redis` at `localhost:6379`

Data is persisted to named volumes:
- App DB: `app-data` mounted at `/data` in the container (`SQLITE_PATH=/data/listener.db`)
- Logs: `app-logs` mounted at `/logs`
- Redis data: `redis-data`

### 2. View logs
```bash
docker-compose logs -f app
```

### 3. Stop
```bash
docker-compose down
```

### 4. Clean volumes (dangerous: removes persisted data)
```bash
docker-compose down -v
```

## 🔧 Configuration

The system can be configured via environment variables:

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# SQLite Configuration
SQLITE_PATH=./data/listener.db

# Scheduler Configuration
MAX_CONCURRENT_POLLS=5
POLL_INTERVAL_MS=10000

# Admin API Configuration
ADMIN_PORT=3001

# Monitoring Configuration
LOG_LEVEL=info
ENABLE_METRICS=true
```

## 📡 API Endpoints

### Main Scraper API (Port 2456)

- `GET /getListings?url=WILLHABEN_URL` - Scrape single page
- `GET /getAllListings?url=WILLHABEN_URL` - Scrape all pages
- `GET /listener/status` - Listener system status
- `GET /listener/health` - Health check
- `GET /listener/metrics` - Prometheus metrics

### Listener Management

- `POST /listener/targets` - Add polling target
- `GET /listener/targets` - List all targets
- `DELETE /listener/targets/:id` - Remove target
- `POST /listener/subscribers` - Add notification subscriber
- `GET /listener/subscribers` - List subscribers

### Admin API (Port 3001)

Full REST API for system management:
- `GET /api/admin/health` - System health
- `GET /api/admin/status` - Detailed status
- `GET /api/admin/metrics` - Prometheus metrics
- `GET /api/admin/dashboard` - Dashboard data
- `GET /api/admin/targets` - Manage polling targets
- `GET /api/admin/events` - Event management
- `GET /api/admin/subscribers` - Subscriber management

## 🎯 Usage Examples

### 1. Add a Polling Target

```bash
curl -X POST http://localhost:2456/listener/targets \
  -H "Content-Type: application/json" \
  -d '{
    "id": "macbook-pros",
    "url": "https://www.willhaben.at/iad/kleinanzeigen?CATEGORY=1&PRICE_FROM=1000&PRICE_TO=3000&SEARCH_TEXT=macbook%20pro",
    "baseInterval": 300,
    "minInterval": 60,
    "maxInterval": 1800,
    "trackedFields": ["title", "price", "condition", "location"],
    "enabled": true
  }'
```

### 2. Add a Webhook Subscriber

```bash
curl -X POST http://localhost:2456/listener/subscribers \
  -H "Content-Type: application/json" \
  -d '{
    "type": "webhook",
    "endpoint": "https://your-app.com/webhook",
    "config": {
      "retryPolicy": "exponential",
      "timeout": 10000
    },
    "enabled": true
  }'
```

### 3. Check System Status

```bash
curl http://localhost:2456/listener/status
```

### 4. View Metrics

```bash
curl http://localhost:2456/listener/metrics
```

## 📊 Monitoring

### Prometheus Metrics

The system exposes Prometheus metrics at `/listener/metrics`:

- `listener_polls_total` - Total polling attempts
- `listener_poll_duration_seconds` - Polling duration histogram
- `listener_changes_detected_total` - Changes detected counter
- `listener_events_processed_total` - Events processed counter
- `listener_active_polls` - Currently active polls
- `listener_queue_length` - Polling queue length
- `listener_pending_events` - Pending events in outbox

### Health Checks

- `GET /listener/health` - Basic health check
- `GET /api/admin/health` - Detailed health information

### Logging

Structured JSON logging with Winston:
- Console output with colors
- File rotation (10MB files, 5 files max)
- Log levels: debug, info, warn, error

## 🔄 System Architecture

### Core Components

1. **Scheduler**: Orchestrates intelligent polling with adaptive intervals
2. **ScraperWorker**: Executes scraping tasks with retry logic
3. **StateStore**: Manages canonical state with Redis + SQLite
4. **DiffEngine**: Detects and categorizes changes
5. **NotificationService**: Delivers events to subscribers
6. **MonitoringService**: Provides observability and metrics

### Data Flow

```
Target URLs → Scheduler → ScraperWorker → DiffEngine → StateStore
                                                      ↓
Subscribers ← NotificationService ← Event Outbox ← StateStore
```

### Change Detection

1. **Hash Comparison**: Fast equality checks using field hashes
2. **Field-Level Diffing**: Detailed comparison of individual fields
3. **Semantic Analysis**: Understands meaningful vs. cosmetic changes
4. **Threshold Detection**: Configurable sensitivity levels

## 🛡️ Reliability Features

### Circuit Breakers
- Automatic failure detection
- Graceful degradation
- Recovery testing

### Retry Logic
- Exponential backoff with jitter
- Configurable retry limits
- Dead letter queue for failed events

### Data Consistency
- ACID transactions for critical updates
- Event sourcing for complete audit trail
- Periodic reconciliation jobs

## 📈 Scaling

### Horizontal Scaling
- Stateless workers
- Redis-based coordination
- Queue-based processing

### Performance Optimization
- Multi-level caching
- Batch processing
- Connection pooling
- Adaptive polling

## 🔧 Development

### Project Structure

```
src/
├── models/           # Data models (Listing, PollingTarget, etc.)
├── stores/           # State management (Redis + SQLite)
├── engines/          # Core logic (DiffEngine)
├── scheduler/        # Polling orchestration
├── workers/          # Scraping workers
├── services/         # Business services (Notification, Monitoring)
├── api/              # Admin API
└── ListenerSystem.js # Main system integration
```

### Running Tests

```bash
npm test
```

### Development Mode

```bash
npm run dev
```

## 🚨 Troubleshooting

### Common Issues

1. **Redis Connection Failed**
   - Ensure Redis server is running
   - Check connection parameters
   - Verify network connectivity

2. **SQLite Database Locked**
   - Check file permissions
   - Ensure no other processes are accessing the DB
   - Verify disk space

3. **High Memory Usage**
   - Monitor heap usage in metrics
   - Check for memory leaks in logs
   - Adjust batch sizes if needed

4. **Polling Failures**
   - Check circuit breaker status
   - Verify target URLs are accessible
   - Review rate limiting settings

### Debug Mode

```bash
LOG_LEVEL=debug npm start
```

## 📝 License

ISC License

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📞 Support

For issues and questions:
- Create an issue on GitHub
- Check the troubleshooting section
- Review the logs for error details
