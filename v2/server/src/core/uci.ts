/**
 * UCIClient — reads and writes OpenWrt UCI config files directly.
 *
 * UCI files live in /etc/config/ and have a simple grammar:
 *   config <type> ['<name>']
 *     option <key> '<value>'
 *     list <key> '<value>'
 *
 * This parser handles the full grammar without shelling out to `uci`.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface UCISection {
  '.type': string;
  '.name': string;
  '.anonymous': boolean;
  [key: string]: string | string[] | boolean;
}

export interface UCIConfig {
  name: string;
  sections: UCISection[];
}

export interface UCIClientOptions {
  configDir?: string; // defaults to /etc/config
}

export class UCIClient {
  private configDir: string;
  private cache = new Map<string, UCIConfig>();

  constructor(opts?: UCIClientOptions) {
    this.configDir = opts?.configDir ?? '/etc/config';
  }

  /** List all available config files */
  async configs(): Promise<string[]> {
    const files = await readdir(this.configDir);
    return files.filter(f => !f.startsWith('.') && !f.endsWith('.bak'));
  }

  /** Load and parse a config file. Results are cached until invalidate(). */
  async load(name: string): Promise<UCIConfig> {
    const cached = this.cache.get(name);
    if (cached) return cached;

    const path = join(this.configDir, name);
    const content = await readFile(path, 'utf-8');
    const config = this.parse(name, content);
    this.cache.set(name, config);
    return config;
  }

  /** Get all sections of a config, optionally filtered by type */
  async sections(configName: string, type?: string): Promise<UCISection[]> {
    const config = await this.load(configName);
    if (type) return config.sections.filter(s => s['.type'] === type);
    return config.sections;
  }

  /** Get a specific named section */
  async get(configName: string, sectionName: string): Promise<UCISection | undefined> {
    const config = await this.load(configName);
    return config.sections.find(s => s['.name'] === sectionName);
  }

  /** Get a single value from a section */
  async getValue(configName: string, sectionName: string, option: string): Promise<string | string[] | undefined> {
    const section = await this.get(configName, sectionName);
    if (!section) return undefined;
    const val = section[option];
    if (typeof val === 'boolean') return undefined;
    return val;
  }

  /** Set a value in a section (in memory + writes to disk) */
  async set(configName: string, sectionName: string, option: string, value: string | string[]): Promise<void> {
    const config = await this.load(configName);
    const section = config.sections.find(s => s['.name'] === sectionName);
    if (!section) throw new Error(`UCI section ${configName}.${sectionName} not found`);
    section[option] = value;
    await this.write(config);
  }

  /** Add a new section, returns the generated name */
  async addSection(configName: string, type: string, name?: string): Promise<string> {
    const config = await this.load(configName);
    const sectionName = name ?? this.generateName(config);
    config.sections.push({
      '.type': type,
      '.name': sectionName,
      '.anonymous': !name,
    });
    await this.write(config);
    return sectionName;
  }

  /** Delete a section */
  async deleteSection(configName: string, sectionName: string): Promise<void> {
    const config = await this.load(configName);
    config.sections = config.sections.filter(s => s['.name'] !== sectionName);
    await this.write(config);
  }

  /** Clear the in-memory cache for a config (or all) */
  invalidate(name?: string): void {
    if (name) this.cache.delete(name);
    else this.cache.clear();
  }

  /** Parse UCI config text into structured data */
  private parse(name: string, content: string): UCIConfig {
    const sections: UCISection[] = [];
    let current: UCISection | null = null;
    let anonCounter = 0;

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const configMatch = line.match(/^config\s+(\S+)(?:\s+'([^']*)'|\s+"([^"]*)"|(?:\s+(\S+)))?/);
      if (configMatch) {
        const type = configMatch[1];
        const sectionName = configMatch[2] ?? configMatch[3] ?? configMatch[4];
        current = {
          '.type': type,
          '.name': sectionName ?? `cfg${String(anonCounter++).padStart(6, '0')}`,
          '.anonymous': !sectionName,
        };
        sections.push(current);
        continue;
      }

      if (!current) continue;

      const optionMatch = line.match(/^option\s+(\S+)\s+'([^']*)'|^option\s+(\S+)\s+"([^"]*)"|^option\s+(\S+)\s+(\S+)/);
      if (optionMatch) {
        const key = optionMatch[1] ?? optionMatch[3] ?? optionMatch[5];
        const val = optionMatch[2] ?? optionMatch[4] ?? optionMatch[6];
        current[key] = val;
        continue;
      }

      const listMatch = line.match(/^list\s+(\S+)\s+'([^']*)'|^list\s+(\S+)\s+"([^"]*)"|^list\s+(\S+)\s+(\S+)/);
      if (listMatch) {
        const key = listMatch[1] ?? listMatch[3] ?? listMatch[5];
        const val = listMatch[2] ?? listMatch[4] ?? listMatch[6];
        const existing = current[key];
        if (Array.isArray(existing)) {
          existing.push(val);
        } else {
          current[key] = [val];
        }
        continue;
      }
    }

    return { name, sections };
  }

  /** Serialize a config back to UCI format and write to disk */
  private async write(config: UCIConfig): Promise<void> {
    const lines: string[] = [];
    for (const section of config.sections) {
      const nameStr = section['.anonymous'] ? '' : ` '${section['.name']}'`;
      lines.push(`config ${section['.type']}${nameStr}`);

      for (const [key, value] of Object.entries(section)) {
        if (key.startsWith('.')) continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            lines.push(`\tlist ${key} '${item}'`);
          }
        } else if (typeof value === 'string') {
          lines.push(`\toption ${key} '${value}'`);
        }
      }
      lines.push('');
    }

    const path = join(this.configDir, config.name);
    await writeFile(path, lines.join('\n'), 'utf-8');
    this.cache.set(config.name, config);
  }

  private generateName(config: UCIConfig): string {
    const existing = new Set(config.sections.map(s => s['.name']));
    let i = 0;
    while (existing.has(`cfg${String(i).padStart(6, '0')}`)) i++;
    return `cfg${String(i).padStart(6, '0')}`;
  }
}
