#!/bin/bash
# Agent Marketplace — One-command installer for Mac/Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/SCJedi/agent-marketplace/master/setup/install.sh | bash
set -e

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║   Agent Marketplace — Easy Setup     ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# ── Step 1: Check Node.js ──────────────────────
echo "  [1/5] Checking Node.js..."
if command -v node &> /dev/null; then
  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -lt 18 ]; then
    echo ""
    echo "  ERROR: Node.js v18+ is required (you have v$(node -v))"
    echo ""
    echo "  Install the latest version:"
    echo "    Mac:   brew install node"
    echo "    Linux: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
    echo "    Or:    https://nodejs.org/en/download"
    echo ""
    exit 1
  fi
  echo "  Found Node.js $(node -v)"
else
  echo ""
  echo "  ERROR: Node.js is not installed."
  echo ""
  echo "  Install it first:"
  echo "    Mac:   brew install node"
  echo "    Linux: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
  echo "    Or:    https://nodejs.org/en/download"
  echo ""
  exit 1
fi

# ── Step 2: Get the code ───────────────────────
INSTALL_DIR="$HOME/agent-marketplace"

if [ -d "$INSTALL_DIR" ]; then
  echo "  [2/5] Updating existing installation..."
  cd "$INSTALL_DIR"
  if [ -d ".git" ]; then
    git pull --quiet 2>/dev/null || true
  fi
else
  echo "  [2/5] Downloading Agent Marketplace..."
  if command -v git &> /dev/null; then
    git clone --quiet https://github.com/SCJedi/agent-marketplace.git "$INSTALL_DIR"
  else
    echo "  (git not found, downloading zip...)"
    curl -fsSL https://github.com/SCJedi/agent-marketplace/archive/refs/heads/master.zip -o /tmp/am-download.zip
    unzip -q /tmp/am-download.zip -d /tmp/am-extract
    mv /tmp/am-extract/agent-marketplace-master "$INSTALL_DIR"
    rm -rf /tmp/am-download.zip /tmp/am-extract
  fi
fi

cd "$INSTALL_DIR"

# ── Step 3: Install dependencies ───────────────
echo "  [3/5] Installing dependencies..."
npm install --quiet 2>/dev/null

# ── Step 4: Create default config ──────────────
echo "  [4/5] Setting up configuration..."
mkdir -p data

# ── Step 5: Start the node ─────────────────────
echo "  [5/5] Starting your node..."
echo ""

# Start the server in the background
node src/server.js &
SERVER_PID=$!

# Wait for the server to come up
for i in $(seq 1 20); do
  if curl -s http://localhost:3001/health > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo "  ╔══════════════════════════════════════╗"
echo "  ║  Your node is running!               ║"
echo "  ║                                      ║"
echo "  ║  Dashboard: http://localhost:3001/dashboard"
echo "  ║                                      ║"
echo "  ║  Press Ctrl+C to stop.               ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# Open browser
if command -v open &> /dev/null; then
  open "http://localhost:3001/dashboard"
elif command -v xdg-open &> /dev/null; then
  xdg-open "http://localhost:3001/dashboard" 2>/dev/null || true
fi

# Wait for the server process
wait $SERVER_PID
