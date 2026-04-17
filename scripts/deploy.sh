#!/bin/bash
set -euo pipefail

ROUTER="${1:-192.168.50.1}"
VERSION="${2:-1.0.0-r1}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APK="$PROJECT_DIR/dist/laubter_${VERSION}.apk"

# Build if APK doesn't exist
if [ ! -f "$APK" ]; then
    echo "Building APK first..."
    bash "$PROJECT_DIR/packaging/build-apk.sh" "$VERSION"
fi

echo "=== Deploying Laubter UI to $ROUTER ==="

# Upload
echo "[1/3] Uploading APK..."
scp "$APK" "root@${ROUTER}:/tmp/laubter.apk"

# Install
echo "[2/3] Installing..."
ssh "root@${ROUTER}" 'apk add --allow-untrusted /tmp/laubter.apk && rm /tmp/laubter.apk'

# Verify
echo "[3/3] Verifying..."
ssh "root@${ROUTER}" 'ls /usr/share/laubter/index.html && echo "OK: Laubter files installed" || echo "ERROR: Files not found"'

echo ""
echo "=== Deploy complete ==="
echo "Access Laubter at: http://${ROUTER}:3000"
