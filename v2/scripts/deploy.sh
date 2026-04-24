#!/bin/bash
# Deploy Laubter v2 (server + frontend) to the router
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 > /dev/null 2>&1 || true

ROUTER="${1:-192.168.50.1}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
V2_DIR="$(dirname "$SCRIPT_DIR")"
REMOTE_DIR="/usr/share/laubter-v2"

echo "=== Laubter v2 deploy to $ROUTER ==="

# Build server
echo "[1/4] Building server..."
cd "$V2_DIR/server"
npm run build 2>&1 | tail -1

# Build frontend
echo "[2/4] Building frontend..."
cd "$V2_DIR/frontend"
npm run build 2>&1 | tail -1

# Upload
echo "[3/4] Uploading..."
ssh "root@${ROUTER}" "mkdir -p ${REMOTE_DIR}/static"
scp -O "$V2_DIR/server/dist/server.mjs" "root@${ROUTER}:${REMOTE_DIR}/server.mjs"
scp -O -r "$V2_DIR/frontend/build/"* "root@${ROUTER}:${REMOTE_DIR}/static/"

# Configure and restart
echo "[4/4] Starting..."
ssh "root@${ROUTER}" "
# Kill existing v2 server
kill \$(ps | grep 'node.*server.mjs' | grep -v grep | awk '{print \$1}') 2>/dev/null || true
sleep 1

# Start server
cd ${REMOTE_DIR}
STATIC_DIR=${REMOTE_DIR}/static PORT=3001 /usr/local/bin/node server.mjs > /tmp/laubter-v2.log 2>&1 &
sleep 2

# Verify
if ps | grep 'node.*server.mjs' | grep -v grep > /dev/null; then
    echo 'Server running on port 3001'
else
    echo 'FAILED to start! Log:'
    cat /tmp/laubter-v2.log
fi
"

echo ""
echo "=== Done! ==="
echo "UI:   http://${ROUTER}:3001"
echo "API:  http://${ROUTER}:3001/api/plugins"
echo "WS:   ws://${ROUTER}:3001/ws"
