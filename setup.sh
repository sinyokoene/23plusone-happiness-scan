#!/bin/bash

# 23plusone Happiness Scan Platform Setup Script
echo "🚀 Setting up 23plusone Happiness Scan Platform"
echo "==============================================="

# Check prerequisites
echo "1. Checking prerequisites..."

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "✅ Node.js installed: $NODE_VERSION"
else
    echo "❌ Node.js not found. Please install Node.js 14+ from https://nodejs.org"
    exit 1
fi

# Check PostgreSQL
if command -v psql &> /dev/null; then
    echo "✅ PostgreSQL found"
else
    echo "❌ PostgreSQL not found. Please install PostgreSQL"
    echo "   macOS: brew install postgresql"
    echo "   Ubuntu: sudo apt-get install postgresql"
    exit 1
fi

# Install dependencies
echo ""
echo "2. Installing dependencies..."
cd server
npm install
if [ $? -eq 0 ]; then
    echo "✅ Dependencies installed successfully"
else
    echo "❌ Failed to install dependencies"
    exit 1
fi

# Setup environment
echo ""
echo "3. Setting up environment..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✅ Created .env file from template"
    echo "⚠️  Please edit server/.env with your database connection details"
else
    echo "✅ .env file already exists"
fi

# Database setup
echo ""
echo "4. Database setup..."
echo "ℹ️  Next steps:"
echo "   1. Create a PostgreSQL database: createdb happiness_benchmark"
echo "   2. Update DATABASE_URL in server/.env"
echo "   3. Run schema: psql \$DATABASE_URL -f ../db/schema.sql"
echo "   4. Start server: npm start"
echo ""

echo "🎉 Setup complete!"
echo ""
echo "📖 Quick start:"
echo "   cd server"
echo "   # Edit .env with your database URL"
echo "   createdb happiness_benchmark"
echo "   psql \$DATABASE_URL -f ../db/schema.sql"
echo "   npm start"
echo ""
echo "🌐 Then visit: http://localhost:3000"
