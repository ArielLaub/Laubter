# Laubter v2 — Setup Guide

## Router: Node.js Installation (OpenWrt 25.x APK + musl)

Node.js is not in the default OpenWrt APK repos. Install the unofficial musl build:

```sh
# Install xz for decompression
apk add xz

# Download Node.js 22 LTS (arm64 musl)
curl -fsSL -o /tmp/node.tar.xz \
  https://unofficial-builds.nodejs.org/download/release/v22.22.2/node-v22.22.2-linux-arm64-musl.tar.xz

# Extract and install
cd /tmp && xz -d node.tar.xz && tar xf node.tar
mkdir -p /usr/local/bin
cp node-v22.22.2-linux-arm64-musl/bin/node /usr/local/bin/node
chmod +x /usr/local/bin/node

# Verify
node --version  # v22.22.2

# Cleanup
rm -rf /tmp/node-v22* /tmp/node.tar
```

### Why not Bun?

Bun's musl build requires `libstdc++` which is unavailable in OpenWrt's repos. The musl variant links against glibc's libstdc++ — incompatible with OpenWrt's pure musl environment.

### Why not the OpenWrt Node.js package?

OpenWrt 25.x (APK) doesn't include Node.js in its default feeds. The community feed ([nxhack/openwrt-node-packages](https://github.com/nxhack/openwrt-node-packages)) exists but requires a custom build. The unofficial binary is simpler.

## Router Info

| Item | Value |
|------|-------|
| Architecture | aarch64 (ARMv8) |
| OS | OpenWrt 25.12.2 |
| Package manager | APK (Alpine) |
| libc | musl |
| RAM | 4 GB |
| Platform | Rockchip |
| Node.js | v22.22.2 (unofficial musl build) |
| v1 UI | Port 3000 (uhttpd + rpcd shell plugins) |
| **v2 UI** | **Port 3001 (Node.js + TypeScript)** |

## Development

```sh
cd v2/server
npm install
npm run dev          # tsx watch — auto-reload on file changes
```

Server starts on http://localhost:3001 with:
- REST API at `/api/*`
- WebSocket at `ws://localhost:3001/ws`
- Static frontend at `/`

## Deploy to Router

```sh
cd v2
./scripts/deploy.sh  # builds + uploads + restarts service
```
