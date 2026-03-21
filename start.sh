#!/bin/bash
echo ""
echo "🩸 Starting HSBlood..."
echo ""

if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Install from https://nodejs.org"
  exit 1
fi

if [ ! -f "backend/.env" ]; then
  echo "⚙️  No .env found — creating from template..."
  cp backend/.env.example backend/.env
  echo "✅ Created backend/.env"
  echo "   Edit it with your MongoDB URI before continuing."
  echo ""
fi

if [ ! -d "backend/node_modules" ]; then
  echo "📦 Installing dependencies..."
  cd backend && npm install && cd ..
fi

echo "✅ Server starting at http://localhost:3000"
echo "   Open http://localhost:3000 in your browser"
echo ""
echo "Press Ctrl+C to stop."
echo ""
cd backend && node server.js
