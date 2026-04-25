/**
 * VPN plugin — WireGuard server management, peer CRUD, QR codes, config export, DDNS.
 * Full feature parity with v1 laubter-vpn + laubter-ddns rpcd plugins.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { sendJson, readJson } from '../core/router.js';
import type { Plugin, PluginContext, PluginRegistration } from '../types/plugin.js';

const exec = promisify(execFile);
const WG_DIR = '/etc/wireguard';
const DDNS_TOKEN_FILE = '/etc/laubter_ddns_token';

// --- Key generation ---
async function genKey(): Promise<{ privateKey: string; publicKey: string }> {
  const { stdout: priv } = await exec('wg', ['genkey']);
  const privateKey = String(priv).trim();
  const { stdout: pub } = await exec('sh', ['-c', `echo "${privateKey}" | wg pubkey`]);
  return { privateKey, publicKey: String(pub).trim() };
}

async function genPsk(): Promise<string> {
  const { stdout } = await exec('wg', ['genpsk']);
  return String(stdout).trim();
}

async function derivePublicKey(privateKey: string): Promise<string> {
  const { stdout } = await exec('sh', ['-c', `echo "${privateKey}" | wg pubkey`]);
  return String(stdout).trim();
}

// --- WireGuard status ---
async function getWgStatus(): Promise<{ running: boolean; listenPort: string; peers: any[] }> {
  try {
    const { stdout } = await exec('wg', ['show', 'wg0', 'dump'], { timeout: 5000 });
    const lines = stdout.trim().split('\n');
    if (lines.length === 0) return { running: false, listenPort: '', peers: [] };

    const [, , listenPort] = lines[0].split('\t');
    const peers = lines.slice(1).map(line => {
      const [publicKey, psk, endpoint, allowedIps, latestHandshake, rxBytes, txBytes] = line.split('\t');
      return { publicKey, endpoint: endpoint === '(none)' ? '' : endpoint, allowedIps, latestHandshake: parseInt(latestHandshake) || 0, rxBytes: parseInt(rxBytes) || 0, txBytes: parseInt(txBytes) || 0 };
    });
    return { running: true, listenPort, peers };
  } catch {
    return { running: false, listenPort: '', peers: [] };
  }
}

// --- DDNS helpers ---
async function getDdnsConfig(ctx: PluginContext): Promise<Record<string, string>> {
  try {
    const section = await ctx.uci.get('laubter', 'ddns');
    if (!section) return {};
    let hasToken = false;
    try { await readFile(DDNS_TOKEN_FILE, 'utf-8'); hasToken = true; } catch {}
    return {
      enabled: (section.enabled as string) ?? '0',
      provider: (section.provider as string) ?? 'duckdns',
      domain: (section.domain as string) ?? '',
      interval: (section.interval as string) ?? '300',
      hasToken: hasToken ? '1' : '0'
    };
  } catch {
    return { enabled: '0', provider: 'duckdns', domain: '', interval: '300', hasToken: '0' };
  }
}

const plugin: Plugin = {
  manifest: { name: 'vpn', version: '2.0.0', description: 'WireGuard VPN with peer management, QR codes, DDNS' },

  async setup(ctx: PluginContext): Promise<PluginRegistration> {
    await mkdir(WG_DIR, { recursive: true }).catch(() => {});

    return {
      routes: [
        // --- Server status ---
        {
          method: 'GET', path: '/api/vpn/status',
          handler: async (_req, res) => {
            const wg = await getWgStatus();
            const ifaces = await ctx.uci.sections('network', 'interface');
            const wg0 = ifaces.find(i => i.proto === 'wireguard');
            const addresses = wg0 ? (Array.isArray(wg0.addresses) ? wg0.addresses : [wg0.addresses]).filter(Boolean) : [];

            // Merge UCI peer names with WG status
            const uciPeers = (await ctx.uci.sections('network')).filter(s => (s['.type'] as string).startsWith('wireguard_'));
            const peers = uciPeers.map(p => {
              const live = wg.peers.find(wp => wp.publicKey === p.public_key);
              return {
                section: p['.name'],
                description: p.description ?? '',
                publicKey: p.public_key ?? '',
                allowedIps: Array.isArray(p.allowed_ips) ? p.allowed_ips.join(', ') : p.allowed_ips ?? '',
                endpoint: live?.endpoint ?? '',
                latestHandshake: live?.latestHandshake ?? 0,
                rxBytes: live?.rxBytes ?? 0,
                txBytes: live?.txBytes ?? 0,
                online: live ? (Date.now() / 1000 - live.latestHandshake < 180) : false
              };
            });

            let serverPubKey = '';
            try {
              const privKey = wg0?.private_key as string;
              if (privKey) serverPubKey = await derivePublicKey(privKey);
            } catch {}

            sendJson(res, 200, {
              running: wg.running,
              listenPort: wg.listenPort || wg0?.listen_port || '',
              addresses,
              publicKey: serverPubKey,
              peers
            });
          }
        },

        // --- Peer CRUD ---
        {
          method: 'POST', path: '/api/vpn/peers',
          handler: async (req, res) => {
            const body = await readJson<{ name: string; allowed_ip?: string }>(req);
            if (!body.name) { sendJson(res, 400, { error: 'name required' }); return; }

            // Find next available IP
            const uciPeers = (await ctx.uci.sections('network')).filter(s => (s['.type'] as string).startsWith('wireguard_'));
            const usedIps = new Set(uciPeers.map(p => {
              const ips = Array.isArray(p.allowed_ips) ? p.allowed_ips[0] : p.allowed_ips;
              return (ips as string)?.replace('/32', '');
            }));
            let clientIp = body.allowed_ip;
            if (!clientIp) {
              for (let i = 2; i < 255; i++) {
                const ip = `10.0.0.${i}`;
                if (!usedIps.has(ip)) { clientIp = ip; break; }
              }
            }
            if (!clientIp) { sendJson(res, 500, { error: 'No available IPs' }); return; }

            const keys = await genKey();
            const psk = await genPsk();

            // Save keys to files
            const section = body.name.replace(/[^a-zA-Z0-9_-]/g, '_');
            await writeFile(`${WG_DIR}/peer_${section}.key`, keys.privateKey, { mode: 0o600 });
            await writeFile(`${WG_DIR}/peer_${section}.psk`, psk, { mode: 0o600 });

            // Add UCI section
            const sid = await ctx.uci.addSection('network', 'wireguard_wg0', section);
            await ctx.uci.set('network', sid, 'description', body.name);
            await ctx.uci.set('network', sid, 'public_key', keys.publicKey);
            await ctx.uci.set('network', sid, 'preshared_key', psk);
            await ctx.uci.set('network', sid, 'allowed_ips', [`${clientIp}/32`]);
            await ctx.uci.set('network', sid, 'persistent_keepalive', '25');

            // Reload WireGuard
            await exec('sh', ['-c', 'ifdown wg0 2>/dev/null; sleep 1; ifup wg0 2>/dev/null']).catch(() => {});

            sendJson(res, 201, {
              status: 'ok', name: body.name, section, publicKey: keys.publicKey,
              privateKey: keys.privateKey, psk, allowedIp: `${clientIp}/32`, clientIp
            });
          }
        },
        {
          method: 'DELETE', path: '/api/vpn/peers/:section',
          handler: async (_req, res, params) => {
            await ctx.uci.deleteSection('network', params.section);
            await unlink(`${WG_DIR}/peer_${params.section}.key`).catch(() => {});
            await unlink(`${WG_DIR}/peer_${params.section}.psk`).catch(() => {});
            await exec('sh', ['-c', 'ifdown wg0 2>/dev/null; sleep 1; ifup wg0 2>/dev/null']).catch(() => {});
            sendJson(res, 200, { status: 'ok' });
          }
        },

        // --- Config & QR ---
        {
          method: 'GET', path: '/api/vpn/peers/:section/config',
          handler: async (_req, res, params) => {
            try {
              const privKey = await readFile(`${WG_DIR}/peer_${params.section}.key`, 'utf-8');
              const psk = await readFile(`${WG_DIR}/peer_${params.section}.psk`, 'utf-8');

              const ifaces = await ctx.uci.sections('network', 'interface');
              const wg0 = ifaces.find(i => i.proto === 'wireguard');
              const serverPriv = wg0?.private_key as string;
              const serverPub = serverPriv ? await derivePublicKey(serverPriv) : '';
              const listenPort = wg0?.listen_port ?? '51820';

              const peer = await ctx.uci.get('network', params.section);
              const allowedIps = Array.isArray(peer?.allowed_ips) ? peer.allowed_ips[0] : peer?.allowed_ips;
              const clientIp = (allowedIps as string)?.replace('/32', '');

              // Get endpoint (DDNS or WAN IP)
              const ddns = await getDdnsConfig(ctx);
              let endpoint = '';
              if (ddns.enabled === '1' && ddns.domain) {
                endpoint = `${ddns.domain}.duckdns.org`;
              } else {
                try {
                  const wan = await ctx.ubus.call<Record<string, unknown>>('network.interface.wan', 'status', {});
                  const addrs = wan['ipv4-address'] as { address: string }[];
                  endpoint = addrs?.[0]?.address ?? '';
                } catch {}
              }

              const config = `[Interface]
PrivateKey = ${privKey.trim()}
Address = ${clientIp}/24
DNS = 192.168.50.1

[Peer]
PublicKey = ${serverPub}
PresharedKey = ${psk.trim()}
Endpoint = ${endpoint}:${listenPort}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`;
              sendJson(res, 200, { config });
            } catch (e) {
              sendJson(res, 500, { error: `Config generation failed: ${e}` });
            }
          }
        },
        {
          method: 'GET', path: '/api/vpn/peers/:section/qr',
          handler: async (_req, res, params) => {
            try {
              // Generate config first
              const privKey = await readFile(`${WG_DIR}/peer_${params.section}.key`, 'utf-8');
              const psk = await readFile(`${WG_DIR}/peer_${params.section}.psk`, 'utf-8');
              const ifaces = await ctx.uci.sections('network', 'interface');
              const wg0 = ifaces.find(i => i.proto === 'wireguard');
              const serverPub = wg0?.private_key ? await derivePublicKey(wg0.private_key as string) : '';
              const listenPort = wg0?.listen_port ?? '51820';
              const peer = await ctx.uci.get('network', params.section);
              const clientIp = ((Array.isArray(peer?.allowed_ips) ? peer.allowed_ips[0] : peer?.allowed_ips) as string)?.replace('/32', '');
              const ddns = await getDdnsConfig(ctx);
              let endpoint = ddns.enabled === '1' && ddns.domain ? `${ddns.domain}.duckdns.org` : '';
              if (!endpoint) {
                try { const wan = await ctx.ubus.call<Record<string, unknown>>('network.interface.wan', 'status', {}); endpoint = ((wan['ipv4-address'] as any[])?.[0]?.address) ?? ''; } catch {}
              }

              const config = `[Interface]\nPrivateKey = ${privKey.trim()}\nAddress = ${clientIp}/24\nDNS = 192.168.50.1\n\n[Peer]\nPublicKey = ${serverPub}\nPresharedKey = ${psk.trim()}\nEndpoint = ${endpoint}:${listenPort}\nAllowedIPs = 0.0.0.0/0, ::/0\nPersistentKeepalive = 25`;

              const { stdout } = await exec('qrencode', ['-t', 'SVG', '-o', '-'], { input: config } as any);
              sendJson(res, 200, { qr_svg_base64: Buffer.from(stdout).toString('base64') });
            } catch (e) {
              sendJson(res, 500, { error: `QR generation failed: ${e}` });
            }
          }
        },

        // --- Server public key ---
        {
          method: 'GET', path: '/api/vpn/publickey',
          handler: async (_req, res) => {
            try {
              const ifaces = await ctx.uci.sections('network', 'interface');
              const wg0 = ifaces.find(i => i.proto === 'wireguard');
              const pub = wg0?.private_key ? await derivePublicKey(wg0.private_key as string) : '';
              sendJson(res, 200, { publicKey: pub });
            } catch {
              sendJson(res, 200, { publicKey: '' });
            }
          }
        },

        // --- DDNS ---
        {
          method: 'GET', path: '/api/vpn/ddns',
          handler: async (_req, res) => {
            const config = await getDdnsConfig(ctx);
            // Get public IP
            let publicIp = '';
            try { const { stdout } = await exec('curl', ['-sf', '--max-time', '5', 'https://api.ipify.org']); publicIp = stdout.trim(); } catch {}
            sendJson(res, 200, { ...config, publicIp });
          }
        },
        {
          method: 'PUT', path: '/api/vpn/ddns',
          handler: async (req, res) => {
            const body = await readJson<{ enabled: string; provider: string; domain: string; token?: string; interval: string }>(req);
            try {
              // Ensure laubter.ddns section exists
              try { await ctx.uci.get('laubter', 'ddns'); } catch { await ctx.uci.addSection('laubter', 'ddns', 'ddns'); }
              await ctx.uci.set('laubter', 'ddns', 'enabled', body.enabled);
              await ctx.uci.set('laubter', 'ddns', 'provider', body.provider || 'duckdns');
              await ctx.uci.set('laubter', 'ddns', 'domain', body.domain);
              await ctx.uci.set('laubter', 'ddns', 'interval', body.interval || '300');
              if (body.token) await writeFile(DDNS_TOKEN_FILE, body.token, { mode: 0o600 });
              sendJson(res, 200, { status: 'ok' });
            } catch (e) {
              sendJson(res, 500, { error: String(e) });
            }
          }
        },
        {
          method: 'POST', path: '/api/vpn/ddns/test',
          handler: async (_req, res) => {
            try {
              const config = await getDdnsConfig(ctx);
              const token = await readFile(DDNS_TOKEN_FILE, 'utf-8').catch(() => '');
              if (!config.domain || !token) { sendJson(res, 400, { error: 'DDNS not configured' }); return; }
              const { stdout } = await exec('curl', ['-sf', '--max-time', '10', `https://www.duckdns.org/update?domains=${config.domain}&token=${token.trim()}&verbose=true`]);
              const lines = stdout.trim().split('\n');
              const ok = lines[0] === 'OK';
              const ip = lines[1] || '';
              sendJson(res, 200, { status: ok ? 'ok' : 'error', ip, domain: `${config.domain}.duckdns.org` });
            } catch (e) {
              sendJson(res, 500, { error: String(e) });
            }
          }
        }
      ]
    };
  }
};

export default plugin;
