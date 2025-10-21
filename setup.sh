#!/bin/bash

# Willhaben Listener System Setup Script
# This script helps set up the complete listener system

set -e

echo "🚀 Setting up Willhaben Listener System..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo "❌ Node.js version 16+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p data logs

# Check if Redis is available
echo "🔍 Checking Redis availability..."
if command -v redis-cli &> /dev/null; then
    if redis-cli ping &> /dev/null; then
        echo "✅ Redis is running"
    else
        echo "⚠️  Redis is installed but not running"
        echo "   Please start Redis server:"
        echo "   - Docker: docker run -d --name redis -p 6379:6379 redis:alpine"
        echo "   - macOS: brew services start redis"
        echo "   - Ubuntu: sudo systemctl start redis"
    fi
else
    echo "⚠️  Redis is not installed"
    echo "   Please install Redis:"
    echo "   - Docker: docker run -d --name redis -p 6379:6379 redis:alpine"
    echo "   - macOS: brew install redis"
    echo "   - Ubuntu: sudo apt install redis-server"
fi

# Create example configuration file
echo "⚙️  Creating example configuration..."
cat > .env.example << EOF
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
EOF

# Create example usage script
echo "📝 Creating example usage script..."
cat > examples/add-target.sh << 'EOF'
#!/bin/bash

# Example: Add a polling target for MacBook Pro listings
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

echo ""
echo "Target added! Check status at: http://localhost:2456/listener/status"
EOF

chmod +x examples/add-target.sh

# Create example webhook subscriber script
cat > examples/add-webhook.sh << 'EOF'
#!/bin/bash

# Example: Add a webhook subscriber
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

echo ""
echo "Webhook subscriber added!"
EOF

chmod +x examples/add-webhook.sh

# Create monitoring script
cat > examples/monitor.sh << 'EOF'
#!/bin/bash

echo "📊 Willhaben Listener System Monitoring"
echo "======================================"

echo ""
echo "🔍 System Status:"
curl -s http://localhost:2456/listener/status | jq '.'

echo ""
echo "❤️  Health Check:"
curl -s http://localhost:2456/listener/health | jq '.'

echo ""
echo "📈 Active Targets:"
curl -s http://localhost:2456/listener/targets | jq '.[] | {id: .id, url: .url, enabled: .enabled, lastPolledAt: .lastPolledAt}'

echo ""
echo "🔔 Subscribers:"
curl -s http://localhost:2456/listener/subscribers | jq '.[] | {id: .id, type: .type, endpoint: .endpoint, enabled: .enabled}'
EOF

chmod +x examples/monitor.sh

echo ""
echo "✅ Setup complete!"
echo ""
echo "🚀 To start the system:"
echo "   npm start"
echo ""
echo "📊 Available endpoints:"
echo "   Main API: http://localhost:2456"
echo "   Admin API: http://localhost:3001/api/admin"
echo "   Status: http://localhost:2456/listener/status"
echo "   Health: http://localhost:2456/listener/health"
echo "   Metrics: http://localhost:2456/listener/metrics"
echo ""
echo "📝 Example usage:"
echo "   ./examples/add-target.sh"
echo "   ./examples/add-webhook.sh"
echo "   ./examples/monitor.sh"
echo ""
echo "📚 Documentation:"
echo "   See README.md for complete documentation"
echo ""
echo "⚠️  Make sure Redis is running before starting the system!"
