/**
 * PluginLoader — discovers and loads plugins from the plugins directory.
 *
 * Each plugin is a .ts/.js file that default-exports a Plugin object.
 * Plugins are loaded in dependency order.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin, PluginContext, PluginRegistration } from '../types/plugin.js';
import type { HttpRouter } from './router.js';
import type { WebSocketHub } from './websocket.js';

export interface LoadedPlugin {
  plugin: Plugin;
  registration: PluginRegistration;
}

export class PluginLoader {
  private loaded = new Map<string, LoadedPlugin>();
  private collectorTimers: ReturnType<typeof setInterval>[] = [];

  /** Discover and load all plugins */
  async loadAll(
    pluginsDir: string,
    ctx: PluginContext,
    router: HttpRouter,
    wsHub: WebSocketHub
  ): Promise<void> {
    const files = await readdir(pluginsDir);
    const pluginFiles = files.filter(f => f.endsWith('.ts') || f.endsWith('.js'));

    // First pass: import all plugins
    const pending: Plugin[] = [];
    for (const file of pluginFiles) {
      try {
        const mod = await import(join(pluginsDir, file));
        const plugin: Plugin = mod.default ?? mod;
        if (plugin?.manifest?.name) {
          pending.push(plugin);
        } else {
          console.warn(`[loader] ${file}: no valid manifest, skipping`);
        }
      } catch (err) {
        console.error(`[loader] Failed to import ${file}:`, err);
      }
    }

    // Sort by dependencies (simple topological sort)
    const sorted = this.topoSort(pending);

    // Second pass: setup in order
    for (const plugin of sorted) {
      const { name } = plugin.manifest;
      try {
        ctx.log = (msg: string) => console.log(`[${name}] ${msg}`);
        const registration = await plugin.setup(ctx);

        // Register routes
        for (const route of registration.routes ?? []) {
          router.add(route);
          console.log(`  route: ${route.method} ${route.path}`);
        }

        // Register WebSocket subscriptions
        for (const sub of registration.subscriptions ?? []) {
          wsHub.registerSubscription(sub);
          console.log(`  ws: ${sub.topic} (${sub.interval}ms)`);
        }

        // Start collectors
        for (const collector of registration.collectors ?? []) {
          const timer = setInterval(async () => {
            try { await collector.run(); } catch (err) {
              console.error(`[${name}] collector ${collector.name} error:`, err);
            }
          }, collector.interval);
          this.collectorTimers.push(timer);
          console.log(`  collector: ${collector.name} (${collector.interval}ms)`);
        }

        this.loaded.set(name, { plugin, registration });
        console.log(`[loader] Loaded: ${name} v${plugin.manifest.version}`);
      } catch (err) {
        console.error(`[loader] Failed to setup ${name}:`, err);
      }
    }
  }

  /** Simple topological sort by dependencies */
  private topoSort(plugins: Plugin[]): Plugin[] {
    const byName = new Map(plugins.map(p => [p.manifest.name, p]));
    const sorted: Plugin[] = [];
    const visited = new Set<string>();

    const visit = (p: Plugin) => {
      if (visited.has(p.manifest.name)) return;
      visited.add(p.manifest.name);
      for (const dep of p.manifest.dependencies ?? []) {
        const depPlugin = byName.get(dep);
        if (depPlugin) visit(depPlugin);
      }
      sorted.push(p);
    };

    for (const p of plugins) visit(p);
    return sorted;
  }

  /** Stop all collectors */
  shutdown(): void {
    for (const timer of this.collectorTimers) clearInterval(timer);
    this.collectorTimers = [];
  }

  get plugins(): Map<string, LoadedPlugin> { return this.loaded; }
}
