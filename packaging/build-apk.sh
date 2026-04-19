#!/bin/bash
set -euo pipefail

VERSION="${1:-1.0.0-r1}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/build/apk"
DIST_DIR="$PROJECT_DIR/dist"
SDK_IMAGE="openwrt/sdk:rockchip-armv8-25.12.2"

echo "=== Building Laubter APK v${VERSION} ==="

# Step 1: Build the frontend SPA
echo "[1/3] Building frontend..."
cd "$PROJECT_DIR/frontend"
npm run build

# Step 2: Assemble file tree
echo "[2/3] Assembling package tree..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/usr/share/laubter"
mkdir -p "$BUILD_DIR/usr/libexec/rpcd"
mkdir -p "$BUILD_DIR/usr/bin"
mkdir -p "$BUILD_DIR/usr/share/rpcd/acl.d"
mkdir -p "$DIST_DIR"

# Copy frontend build output
cp -r "$PROJECT_DIR/frontend/dist/"* "$BUILD_DIR/usr/share/laubter/"

# Bake version file
echo "$VERSION" > "$BUILD_DIR/usr/share/laubter/version"

# Copy rpcd plugins
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

# Step 3: Create APK using OpenWrt SDK's apk mkpkg (ADB v3 format)
echo "[3/3] Creating APK..."

docker run --rm --platform linux/amd64 \
    -v "$BUILD_DIR:/pkg:ro" \
    -v "$SCRIPT_DIR:/scripts:ro" \
    -v "$DIST_DIR:/dist" \
    "$SDK_IMAGE" sh -c '
        staging_dir/host/bin/apk mkpkg \
            -I name:laubter \
            -I version:'"${VERSION}"' \
            -I arch:noarch \
            -I license:MIT \
            -I "description:Laubter - Modern web interface for OpenWrt" \
            -I depends:uhttpd \
            -I depends:rpcd \
            -I depends:rpcd-mod-file \
            -I depends:rpcd-mod-iwinfo \
            -I depends:curl \
            -I depends:coreutils-base64 \
            -I depends:jsonfilter \
            -s post-install:/scripts/postinst \
            -s pre-deinstall:/scripts/prerm \
            -F /pkg \
            -o /dist/laubter-'"${VERSION}"'.apk
    '

# Also create a stable-name copy for GitHub releases
cp "$DIST_DIR/laubter-${VERSION}.apk" "$DIST_DIR/laubter.apk"

APK_SIZE=$(du -h "$DIST_DIR/laubter-${VERSION}.apk" | cut -f1)
echo ""
echo "=== Build complete ==="
echo "APK: $DIST_DIR/laubter-${VERSION}.apk ($APK_SIZE)"
echo ""
echo "Install on router:"
echo "  scp $DIST_DIR/laubter-${VERSION}.apk root@<router>:/tmp/"
echo "  ssh root@<router> 'apk add --allow-untrusted /tmp/laubter-${VERSION}.apk'"
