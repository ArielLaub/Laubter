#!/bin/bash
# Deploy Laubter v2 server to the router
set -euo pipefail

ROUTER="${1:-192.168.50.1}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
V2_DIR="$(dirname "$SCRIPT_DIR")"
REMOTE_DIR="/usr/share/laubter-v2"

echo "=== Laubter v2 deploy to $ROUTER ==="

# Build server
echo "[1/3] Building server..."
cd "$V2_DIR/server"
npm run build 2>&1 | tail -1

# Upload
echo "[2/3] Uploading..."
ssh "root@${ROUTER}" "mkdir -p ${REMOTE_DIR}"
scp -O "$V2_DIR/server/dist/server.mjs" "root@${ROUTER}:${REMOTE_DIR}/server.mjs"

# Configure and restart
echo "[3/3] Starting..."
ssh "root@${ROUTER}" "
# Kill existing v2 server
pkill -f 'node.*server.mjs' 2>/dev/null || true
sleep 1

# Start server (port 3001, connects to rpcd on localhost)
cd ${REMOTE_DIR}
UBUS_URL=http://127.0.0.1/ubus PORT=3001 /usr/local/bin/node server.mjs > /tmp/laubter-v2.log 2>&1 &
sleep 2

# Verify
if pgrep -f 'node.*server.mjs' > /dev/null; then
    echo 'Server running on port 3001'
else
    echo 'FAILED to start! Check /tmp/laubter-v2.log'
    cat /tmp/laubter-v2.log
fi
"

echo ""
echo "=== Done! ==="
echo "API:  http://${ROUTER}:3001/api/plugins"
echo "WS:   ws://${ROUTER}:3001/ws"
