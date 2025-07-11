#!/bin/bash

# Health check script for 23plusone Happiness Scan
echo "🏥 Health Check for 23plusone Happiness Scan"
echo "============================================"

# Check if server is running
echo "1. Checking server status..."
if curl -s http://localhost:3000/api/health > /dev/null; then
    echo "✅ Server is running"
    
    # Get health status
    HEALTH=$(curl -s http://localhost:3000/api/health)
    echo "   Status: $HEALTH"
else
    echo "❌ Server is not running"
    echo "   Please start the server with: cd server && npm start"
    exit 1
fi

# Check database connection
echo ""
echo "2. Checking database..."
STATS=$(curl -s http://localhost:3000/api/stats)
if [[ $STATS == *"totalResponses"* ]]; then
    echo "✅ Database connection successful"
    echo "   $STATS"
else
    echo "❌ Database connection failed"
    echo "   Please check your DATABASE_URL in server/.env"
fi

# Check if scan is accessible
echo ""
echo "3. Checking scan page..."
if curl -s http://localhost:3000/scan.html | grep -q "23plusone Happiness Scan"; then
    echo "✅ Scan page is accessible"
else
    echo "❌ Scan page is not accessible"
fi

echo ""
echo "🎯 Test URLs:"
echo "   Demo: http://localhost:3000"
echo "   Scan: http://localhost:3000/scan.html"
echo "   API:  http://localhost:3000/api/health"
