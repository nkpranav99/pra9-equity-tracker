#!/bin/bash
# ============================================================
# Git Pull & Update Script
# ============================================================
# Run this script on your GCP server to pull the latest changes
# from your GitHub repository and restart the bot.
#
# Usage: ./deploy/update.sh
# ============================================================

set -euo pipefail

echo "=========================================="
echo " Updating Equity Bot..."
echo "=========================================="

# Ensure we are in the project root
cd "$(dirname "$0")/.."

# 1. Pull latest code
echo "⬇️ Pulling latest changes from GitHub..."
git pull origin main

# 2. Install dependencies (in case package.json changed)
echo "📦 Installing any new dependencies..."
npm install --production

# 3. Restart bot
echo "🔄 Restarting bot via PM2..."
pm2 restart equity-bot

echo "=========================================="
echo " ✅ Update Complete!"
echo "=========================================="
