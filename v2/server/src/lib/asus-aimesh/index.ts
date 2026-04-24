/**
 * asus-aimesh — TypeScript library for ASUS AiMesh routers
 *
 * Provides:
 * - AsusAiMeshClient: HTTP client for ASUS app API
 * - processTopology: Transform raw API data into normalized mesh topology
 * - Full TypeScript types for all API structures
 */

export { AsusAiMeshClient, AsusError } from './client.js';
export type { AsusClientOptions } from './client.js';
export { processTopology } from './topology.js';
export type {
  // Raw API types
  AsusNodeRaw, AsusClientRaw, AsusTopologyData, AsusTopoClientEntry, AsusNodeConfig,
  // Processed types
  MeshNode, MeshClient, MeshRadio, MeshTopology, NodeConfig,
  // Enums
  BackhaulType, ConnectionQuality, WirelessBand,
  // Config
  AsusConnectionConfig
} from './types.js';
