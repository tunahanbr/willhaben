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
