// Map known hack incidents / sanctioned regions to approximate coordinates
const INCIDENT_COORDS: Record<string, [number, number]> = {
	// Lazarus Group / DPRK
	'Lazarus Group': [39.0392, 125.7625], // Pyongyang
	'Bybit Hack': [39.0392, 125.7625],
	'Ronin Bridge': [39.0392, 125.7625],
	'Harmony Horizon': [39.0392, 125.7625],
	'KuCoin Hack': [39.0392, 125.7625],
	'Atomic Wallet': [39.0392, 125.7625],
	'Stake.com': [39.0392, 125.7625],

	// Other incidents
	'Nomad Bridge': [37.7749, -122.4194], // San Francisco
	'WazirX': [19.076, 72.8777], // Mumbai
	'Tornado Cash': [52.3676, 4.9041], // Amsterdam

	// OFAC sanctioned country capitals
	Iran: [35.6892, 51.389],
	Syria: [33.5138, 36.2765],
	Cuba: [23.1136, -82.3666],
	'North Korea': [39.0392, 125.7625],
	Russia: [55.7558, 37.6173],
	Venezuela: [10.4806, -66.9036],
};

// Rough geo distribution for chains
const CHAIN_REGIONS: Record<string, [number, number][]> = {
	BTC: [
		[40.7128, -74.006], // NYC
		[51.5074, -0.1278], // London
		[35.6762, 139.6503], // Tokyo
		[1.3521, 103.8198], // Singapore
		[37.5665, 126.978], // Seoul
	],
	ETH: [
		[37.7749, -122.4194], // SF
		[47.3769, 8.5417], // Zurich
		[52.52, 13.405], // Berlin
		[25.2048, 55.2708], // Dubai
		[22.3193, 114.1694], // Hong Kong
	],
	DOGE: [
		[34.0522, -118.2437], // LA
		[51.5074, -0.1278], // London
	],
	LTC: [
		[40.7128, -74.006], // NYC
		[48.8566, 2.3522], // Paris
	],
};

export function getIncidentCoords(incident: string): [number, number] {
	for (const [key, coords] of Object.entries(INCIDENT_COORDS)) {
		if (incident.toLowerCase().includes(key.toLowerCase())) {
			return coords;
		}
	}
	// Default: random global position
	return [
		Math.random() * 120 - 60,
		Math.random() * 300 - 150
	];
}

export function getChainCoords(chain: string): [number, number] {
	const regions = CHAIN_REGIONS[chain] || CHAIN_REGIONS['BTC'];
	const idx = Math.floor(Math.random() * regions.length);
	// Add small random offset for visual spread
	const [lat, lng] = regions[idx];
	return [
		lat + (Math.random() - 0.5) * 5,
		lng + (Math.random() - 0.5) * 5
	];
}

export function getSanctionedCountryCoords(entityName: string): [number, number] {
	for (const [key, coords] of Object.entries(INCIDENT_COORDS)) {
		if (entityName.toLowerCase().includes(key.toLowerCase())) {
			const [lat, lng] = coords;
			return [
				lat + (Math.random() - 0.5) * 2,
				lng + (Math.random() - 0.5) * 2
			];
		}
	}
	return [
		Math.random() * 120 - 60,
		Math.random() * 300 - 150
	];
}
