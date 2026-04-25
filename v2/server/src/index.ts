/**
 * Laubter v2 Server — entry point.
 *
 * Wires up: HTTP server, WebSocket hub, ubus client, UCI client, plugin loader.
 * Serves the frontend static files and proxies API/WS to plugins.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UbusClient } from './core/ubus.js';
import { UCIClient } from './core/uci.js';
import { WebSocketHub } from './core/websocket.js';
import { isAuthenticated, authRoutes } from './core/auth.js';
import { HttpRouter, sendJson } from './core/router.js';
import { PluginLoader } from './core/loader.js';
import type { PluginContext } from './types/plugin.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// --- Config ---
const PORT = parseInt(process.env.PORT ?? '3001');
const UBUS_URL = process.env.UBUS_URL ?? 'http://127.0.0.1/ubus';
const STATIC_DIR = process.env.STATIC_DIR ?? join(__dirname, '../../frontend/dist');
const PLUGINS_DIR = process.env.PLUGINS_DIR ?? join(__dirname, 'plugins');

// --- MIME types for static serving ---
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

// --- Bootstrap ---
async function main(): Promise<void> {
  console.log('Laubter v2 starting...');

  // Core services
  const isRouter = process.platform === 'linux' && process.arch === 'arm64';
  const ubusMode = (process.env.UBUS_MODE ?? (isRouter ? 'cli' : 'http')) as 'cli' | 'http';
  const ubus = new UbusClient({ mode: ubusMode, url: UBUS_URL });
  const uci = new UCIClient();
  const wsHub = new WebSocketHub();
  const router = new HttpRouter();
  const loader = new PluginLoader();

  console.log(`[ubus] Mode: ${ubusMode}`);

  if (ubusMode === 'http') {
    try {
      await ubus.login();
      console.log('[ubus] Authenticated');
    } catch (err) {
      console.warn('[ubus] Login failed, running without auth:', err);
    }
  }

  // Plugin context
  const ctx: PluginContext = {
    ubus,
    uci,
    ws: wsHub,
    log: (msg) => console.log(`[core] ${msg}`),
  };

  // Auth routes
  for (const route of authRoutes(ubus)) {
    router.add(route as any);
  }

  // Meta API routes
  router.add({
    method: 'GET',
    path: '/api/plugins',
    handler: (_req, res) => {
      const list = Array.from(loader.plugins.values()).map(p => p.plugin.manifest);
      sendJson(res, 200, { plugins: list });
    }
  });

  // Load plugins — bundled imports + dynamic discovery
  console.log('[loader] Loading plugins...');

  // Bundled plugins (always available)
  const { default: systemPlugin } = await import('./plugins/system.js');
  const { default: networkPlugin } = await import('./plugins/network.js');
  const { default: dhcpPlugin } = await import('./plugins/dhcp.js');
  const { default: firewallPlugin } = await import('./plugins/firewall.js');
  const { default: wirelessPlugin } = await import('./plugins/wireless.js');
  const { default: trafficPlugin } = await import('./plugins/traffic.js');
  const { default: meshPlugin } = await import('./plugins/aimesh.js');
  const { default: vpnPlugin } = await import('./plugins/vpn.js');
  const { default: dnsPlugin } = await import('./plugins/dns.js');
  const bundledPlugins = [systemPlugin, networkPlugin, dhcpPlugin, firewallPlugin, wirelessPlugin, trafficPlugin, meshPlugin, vpnPlugin, dnsPlugin];

  for (const plugin of bundledPlugins) {
    try {
      ctx.log = (msg: string) => console.log(`[${plugin.manifest.name}] ${msg}`);
      const reg = await plugin.setup(ctx);
      for (const route of reg.routes ?? []) { router.add(route); }
      for (const sub of reg.subscriptions ?? []) { wsHub.registerSubscription(sub); }
      loader.registerPlugin(plugin, reg);
      console.log(`  [+] ${plugin.manifest.name} v${plugin.manifest.version}`);
    } catch (err) {
      console.error(`  [-] ${plugin.manifest.name}: ${err}`);
    }
  }

  // Dynamic plugins from disk (dev mode / external plugins)
  try {
    await loader.loadAll(PLUGINS_DIR, ctx, router, wsHub);
  } catch {
    // No plugins dir — that's fine in bundled mode
  }

  console.log(`[loader] ${loader.plugins.size} plugin(s) active`);

  // HTTP server
  const server = createServer(async (req, res) => {
    // CORS for dev
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // Auth check for API routes
    if (!isAuthenticated(req)) {
      sendJson(res, 401, { error: 'Authentication required' });
      return;
    }

    // Try API routes first
    if (await router.handle(req, res)) return;

    // Static file serving (SPA fallback)
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    let filePath = join(STATIC_DIR, url.pathname);

    try {
      const st = await stat(filePath);
      if (st.isDirectory()) filePath = join(filePath, 'index.html');
    } catch {
      // SPA fallback: serve index.html for unknown paths
      filePath = join(STATIC_DIR, 'index.html');
    }

    try {
      const content = await readFile(filePath);
      const ext = extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  // Attach WebSocket
  wsHub.attach(server);

  // Start
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\nLaubter v2 listening on http://0.0.0.0:${PORT}`);
    console.log(`  API:   http://localhost:${PORT}/api/plugins`);
    console.log(`  WS:    ws://localhost:${PORT}/ws`);
    console.log('');
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down...');
    loader.shutdown();
    wsHub.shutdown();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
