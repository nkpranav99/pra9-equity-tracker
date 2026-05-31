#!/bin/bash
# ============================================================
# Cloud Free Tier VM Setup Script (GCP / AWS)
# Equity Trading Bot — Automated Deployment
# ============================================================
# Run this on a fresh Ubuntu 22.04+ instance:
#   chmod +x setup-vm.sh && sudo ./setup-vm.sh
# ============================================================

set -euo pipefail

echo "=========================================="
echo " Equity Bot — Cloud VM Setup (GCP / AWS)"
echo "=========================================="

# --- 1. System Update ---
echo "[1/8] Updating system packages..."
apt update && apt upgrade -y

# --- 2. Install Node.js 20.x ---
echo "[2/8] Installing Node.js 20.x..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

# --- 3. Install PM2 ---
echo "[3/8] Installing PM2 globally..."
npm install -g pm2

# --- 4. Install SQLite ---
echo "[4/8] Installing SQLite build dependencies..."
apt install -y build-essential python3

# --- 6. Create app directory ---
echo "[6/8] Setting up application directory..."
APP_DIR="/opt/equity-bot"
mkdir -p $APP_DIR/logs $APP_DIR/data

# If deploying from git:
# git clone https://github.com/YOUR_USER/equity-bot.git $APP_DIR
# cd $APP_DIR && npm install --production

echo ""
echo "========================================"
echo " Copy your application files to: $APP_DIR"
echo " Then run: cd $APP_DIR && npm install"
echo "========================================"
echo ""

# --- 7. Configure firewall ---
echo "[7/8] Configuring firewall..."
# Allow SSH (should already be open)
ufw allow 22/tcp
# Allow Webhook Server (Kite Redirect)
ufw allow 8080/tcp
# Enable firewall
ufw --force enable

echo "Firewall configured. Port 8080 is open for Kite webhooks."

# --- 8. Done ---
echo "[8/8] Finishing up..."

echo ""
echo "=========================================="
echo " ✅ Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Copy your project files to $APP_DIR"
echo "  2. Create .env file:  cp .env.example .env && nano .env"
echo "  3. Install dependencies: cd $APP_DIR && npm install"
echo "  4. Start the bot: pm2 start ecosystem.config.cjs"
echo "  5. Enable auto-start: pm2 startup && pm2 save"
echo ""
echo "Useful PM2 commands:"
echo "  pm2 status            — Check bot status"
echo "  pm2 logs equity-bot   — View logs"
echo "  pm2 restart equity-bot — Restart bot"
echo "  pm2 monit             — Live monitoring"
echo ""
echo ""
