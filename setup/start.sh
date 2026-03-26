#!/bin/bash
# Agent Marketplace — Quick Start
# Double-click or run: ./start.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo ""
echo "  Starting Agent Marketplace..."
echo "  Dashboard: http://localhost:3001/dashboard"
echo "  Press Ctrl+C to stop."
echo ""

node src/server.js
