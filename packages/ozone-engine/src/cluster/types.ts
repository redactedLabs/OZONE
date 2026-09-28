/** Shapes shared by the EVM and UTXO cluster expansions. */

export interface ClusterMember {
	/** Canonical address (lower-case for EVM). */
	address: string;
	key: string;
	chain: string;
	/** Hops from the attributed addresses (1 = funded by a seed). */
	depth: number;
	/** The address it received from. */
	from: string;
	/** Amount received, in the chain's native unit. */
	value: number;
	tx: string;
	/** Unix seconds. */
	time: number;
}

export interface FrontierNode {
	address: string;
	depth: number;
}

/** Why an expansion stopped before its hop limit. */
export type StopReason = 'budget' | 'quota' | 'maxAddresses' | 'time' | 'noProvider' | 'error';

export interface ExpandResult {
	members: Map<string, ClusterMember>;
	/** Addresses found to be services (never expanded, never listed). */
	services: Set<string>;
	/** Recipients that are contracts (bridges, routers, mixers, …): never listed. */
	contracts: Set<string>;
	requests: number;
	/** Complete up to the hop limit, or cut short (`stop` says why; `frontier` is what is left). */
	truncated: boolean;
	stop?: StopReason;
	error?: string;
	/** Nodes still to expand when cut short (the next run resumes from them). */
	frontier: FrontierNode[];
	skipped: {
		/** Recipients whose contract status could not be read (not listed). */
		codeUnknown: number;
		/** CoinJoin-like transactions not followed. */
		coinjoins: number;
		/** Cross-chain (THORChain/Maya) deposits: the vault output is not followed. */
		deposits: number;
		/** Nodes whose history was longer than the page budget (treated as services). */
		longHistories: number;
	};
}

export function emptyExpandResult(): ExpandResult {
	return {
		members: new Map(),
		services: new Set(),
		contracts: new Set(),
		requests: 0,
		truncated: false,
		frontier: [],
		skipped: { codeUnknown: 0, coinjoins: 0, deposits: 0, longHistories: 0 }
	};
}

/** Where a previous, cut-short run stopped. */
export interface ResumeState {
	frontier: FrontierNode[];
	/** Addresses already members (not added twice). */
	known: string[];
}
