/**
 * Backward-compatibility re-exports from the new wireless-provider store.
 * All mesh store consumers can keep importing from here.
 */

export {
	wirelessTopology as meshTopology,
	wirelessConfig as meshConfig,
	wirelessError as meshError,
	wirelessLoading as meshLoading,
	wirelessNodes as meshNodes,
	wirelessClients as meshClients,
	wirelessSsid as meshSsid,
	wirelessClientMap as meshClientMap,
	wirelessNodeMap as meshNodeMap,
	wirelessClientCount,
	wiredClientCount,
	onlineClientCount,
	fetchWirelessTopology as fetchMeshTopology,
	fetchWirelessConfig as fetchMeshConfig,
	testWirelessConnection as testMeshConnection,
	configureWireless as configureMesh,
	activeProviderName,
	activeProviderLabel,
	activeCapabilities,
	initWirelessProvider,
	switchProvider,
	bindClient
} from './wireless-provider';
