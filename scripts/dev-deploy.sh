#!/bin/bash
# Quick dev deploy: just copy frontend + rpcd plugins to router
# No APK packaging, no uhttpd config — uses existing uhttpd

set -euo pipefail

ROUTER="${1:-192.168.50.1}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Dev deploy to $ROUTER ==="

# Build frontend
echo "[1/4] Building frontend..."
cd "$PROJECT_DIR/frontend"
npm run build 2>&1 | tail -3

# Upload frontend files
echo "[2/4] Uploading frontend..."
ssh "root@${ROUTER}" 'mkdir -p /usr/share/laubter'
scp -r "$PROJECT_DIR/frontend/dist/"* "root@${ROUTER}:/usr/share/laubter/"

# Upload rpcd plugins
echo "[3/4] Uploading rpcd plugins..."
scp "$PROJECT_DIR/rpcd-plugins/"* "root@${ROUTER}:/usr/libexec/rpcd/"
ssh "root@${ROUTER}" 'chmod +x /usr/libexec/rpcd/laubter-*'

# Upload ACL
scp "$PROJECT_DIR/acl/laubter.json" "root@${ROUTER}:/usr/share/rpcd/acl.d/"

# Configure uhttpd if not already done, restart services
echo "[4/4] Configuring..."
ssh "root@${ROUTER}" '
if ! uci -q get uhttpd.laubter > /dev/null 2>&1; then
    uci batch <<-EOF
        set uhttpd.laubter=uhttpd
        set uhttpd.laubter.home="/usr/share/laubter"
        set uhttpd.laubter.listen_http="0.0.0.0:3000"
        set uhttpd.laubter.ubus_prefix="/ubus"
        set uhttpd.laubter.max_requests=3
        commit uhttpd
EOF
fi
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart
'

echo ""
echo "=== Done! ==="
echo "Access: http://${ROUTER}:3000"
