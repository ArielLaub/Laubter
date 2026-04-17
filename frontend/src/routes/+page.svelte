<script lang="ts">
	import SystemStatus from '$components/dashboard/SystemStatus.svelte';
	import InternetStatus from '$components/dashboard/InternetStatus.svelte';
	import MeshStatus from '$components/dashboard/MeshStatus.svelte';
	import ClientsSummary from '$components/dashboard/ClientsSummary.svelte';
	import BandwidthGraph from '$components/dashboard/BandwidthGraph.svelte';
	import TopClients from '$components/dashboard/TopClients.svelte';
	import NetworkActivity from '$components/dashboard/NetworkActivity.svelte';
	import VpnStatus from '$components/dashboard/VpnStatus.svelte';
</script>

<div class="dashboard">
	<!-- Row 1: Status cards — 4 columns -->
	<div class="grid-row status-row">
		<div class="grid-cell"><SystemStatus /></div>
		<div class="grid-cell"><InternetStatus /></div>
		<div class="grid-cell"><MeshStatus /></div>
		<div class="grid-cell"><ClientsSummary /></div>
	</div>

	<!-- Row 2: Bandwidth graph — full width -->
	<div class="grid-row bandwidth-row">
		<div class="grid-cell">
			<BandwidthGraph />
		</div>
	</div>

	<!-- Row 3: Top Clients + Network Activity + VPN -->
	<div class="grid-row bottom-row">
		<div class="grid-cell"><TopClients /></div>
		<div class="grid-cell"><NetworkActivity /></div>
		<div class="grid-cell"><VpnStatus /></div>
	</div>
</div>

<style>
	.dashboard {
		display: flex;
		flex-direction: column;
		gap: 16px;
		max-width: 1400px;
	}

	.grid-row {
		display: grid;
		gap: 16px;
	}

	.status-row {
		grid-template-columns: repeat(4, 1fr);
	}

	.bandwidth-row {
		grid-template-columns: 1fr;
	}

	.bottom-row {
		grid-template-columns: 3fr 2fr 1.5fr;
	}

	@media (max-width: 1200px) {
		.status-row {
			grid-template-columns: repeat(2, 1fr);
		}
		.bottom-row {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 768px) {
		.status-row {
			grid-template-columns: 1fr;
		}
	}
</style>
