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
