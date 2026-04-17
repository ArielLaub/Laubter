#!/bin/bash
set -euo pipefail

VERSION="${1:-1.0.0-r1}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/build/apk"
DIST_DIR="$PROJECT_DIR/dist"

echo "=== Building Laubter APK v${VERSION} ==="

# Step 1: Build the frontend SPA
echo "[1/4] Building frontend..."
cd "$PROJECT_DIR/frontend"
npm run build

# Step 2: Assemble APK structure
echo "[2/4] Assembling package..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/usr/share/laubter"
mkdir -p "$BUILD_DIR/usr/libexec/rpcd"
mkdir -p "$BUILD_DIR/usr/bin"
mkdir -p "$BUILD_DIR/usr/share/rpcd/acl.d"
mkdir -p "$BUILD_DIR/.control"

# Copy frontend build output
cp -r "$PROJECT_DIR/frontend/dist/"* "$BUILD_DIR/usr/share/laubter/"

# Copy rpcd plugins (exclude laubter-mqtt-pub which is a daemon, not a plugin)
for f in "$PROJECT_DIR/rpcd-plugins/"laubter-*; do
    base=$(basename "$f")
    if [ "$base" = "laubter-mqtt-pub" ]; then
        cp "$f" "$BUILD_DIR/usr/bin/"
    else
        cp "$f" "$BUILD_DIR/usr/libexec/rpcd/"
    fi
done
chmod +x "$BUILD_DIR/usr/libexec/rpcd/"* "$BUILD_DIR/usr/bin/"*

# Copy ACL
cp "$PROJECT_DIR/acl/laubter.json" "$BUILD_DIR/usr/share/rpcd/acl.d/"

# Copy install scripts
cp "$SCRIPT_DIR/postinst" "$BUILD_DIR/.control/postinst"
cp "$SCRIPT_DIR/prerm" "$BUILD_DIR/.control/prerm"
chmod +x "$BUILD_DIR/.control/"*

# Step 3: Generate package metadata
echo "[3/4] Generating metadata..."

INSTALLED_SIZE=$(du -sk "$BUILD_DIR/usr" | cut -f1)

cat > "$BUILD_DIR/.PKGINFO" <<EOF
pkgname = laubter
pkgver = ${VERSION}
arch = all
size = ${INSTALLED_SIZE}
pkgdesc = Laubter - Modern web interface for OpenWrt
url = https://github.com/ArielLaub/Laubter
license = MIT
depend = uhttpd
depend = rpcd
depend = rpcd-mod-file
depend = rpcd-mod-iwinfo
depend = curl
depend = coreutils-base64
depend = jsonfilter
EOF

cat > "$BUILD_DIR/.control/control" <<EOF
Package: laubter
Version: ${VERSION}
Architecture: all
Installed-Size: ${INSTALLED_SIZE}
Depends: uhttpd, rpcd, rpcd-mod-file, rpcd-mod-iwinfo, curl, coreutils-base64, jsonfilter, wireguard-tools, qrencode, nlbwmon
Description: Laubter - Modern web UI for OpenWrt
 A modern, UniFi-inspired web interface for OpenWrt routers
 with external mesh WiFi integration (ASUS AiMesh, etc).
 Serves on port 3000 alongside LuCI.
Maintainer: Laubter Contributors
Section: luci
EOF

# Step 4: Create the APK
echo "[4/4] Creating APK..."
mkdir -p "$DIST_DIR"
cd "$BUILD_DIR"
tar -czf "$DIST_DIR/laubter_${VERSION}.apk" .PKGINFO .control usr

# Summary
APK_SIZE=$(du -h "$DIST_DIR/laubter_${VERSION}.apk" | cut -f1)
echo ""
echo "=== Build complete ==="
echo "APK: $DIST_DIR/laubter_${VERSION}.apk ($APK_SIZE)"
echo ""
echo "Install on router:"
echo "  scp $DIST_DIR/laubter_${VERSION}.apk root@<router>:/tmp/"
echo "  ssh root@<router> 'apk add --allow-untrusted /tmp/laubter_${VERSION}.apk'"
