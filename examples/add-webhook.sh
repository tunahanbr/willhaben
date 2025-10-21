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
