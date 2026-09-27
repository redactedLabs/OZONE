/** Short display names for Ozone source ids (badges). */
export const SOURCE_LABELS: Record<string, string> = {
	ofac_sdn: 'OFAC',
	uk_fcdo: 'UK',
	eu_fsf: 'EU',
	chainalysis_oracle: 'Sanctions oracle',
	fbi: 'FBI',
	curated: 'Curated',
	cluster: 'Hack cluster',
	tether: 'Tether',
	circle: 'Circle',
	ethlabels: 'eth-labels',
	scamsniffer: 'ScamSniffer',
	manual: 'Maintainers',
	thorchain_trace: 'THORChain trace',
	thorchain_links: 'Linked account',
	key_twin: 'Same key'
};

export const sourceLabel = (id: string): string => SOURCE_LABELS[id] ?? id;
