/**
 * The auditor view for Redacted view keys (errata E-66): where the page reads the chain, and which
 * Redacted deployments it knows.
 *
 * Everything runs in the visitor's browser. The page reads public chain data from two independent
 * THORChain RPC operators (the two-source check, C5) and sends Ozone only counterparty addresses. The
 * Content-Security-Policy of /view (`viewCsp`) allows network connections to exactly these origins and
 * Ozone's own API.
 */

export interface ChainSource {
	/** Shown in the page's footer line and in errors. */
	name: string;
	/** A CometBFT RPC (GET only: `/status`, `/abci_query`, `/block_results`). */
	rpc: string;
}

/**
 * The two sources must be run by different operators: a sync is accepted only when both answer the
 * same records at one height. Both answer CORS `*` on plain GET requests (no preflight).
 * (thorchain.ibs.team is not usable from a browser: it sends `Access-Control-Allow-Origin` twice.)
 */
export const CHAIN_SOURCES: readonly [ChainSource, ChainSource] = [
	{ name: 'rpc.redacted.money', rpc: 'https://rpc.redacted.money' },
	{ name: 'Liquify', rpc: 'https://gateway.liquify.com/chain/thorchain_rpc' }
];

/** The origins /view may connect to besides its own (Ozone's API and the client module). */
export function chainOrigins(sources: readonly ChainSource[] = CHAIN_SOURCES): string[] {
	return [...new Set(sources.map((s) => new URL(s.rpc).origin))];
}

/** A Redacted Strict deployment the page reads: the proxy contract on a chain. */
export interface DeploymentConfig {
	chain_id: string;
	proxy: string;
	hrp?: string;
	/** The pinned `sub-wallet-v2` code checksum (64 hex), when known. */
	account_code_checksum?: string;
	label?: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
const ADDRESS = /^[a-z]{1,16}1[02-9ac-hj-np-z]{38,90}$/;
const CHAIN_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

/**
 * `PUBLIC_VIEWKEY_DEPLOYMENTS`: a JSON list of `{chain_id, proxy, hrp?, account_code_checksum?, label?}`.
 * Malformed entries are dropped (the page then answers "a deployment Ozone does not read").
 */
export function parseDeployments(raw: string | undefined | null): DeploymentConfig[] {
	if (!raw || !raw.trim()) return [];
	let list: unknown;
	try {
		list = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(list)) return [];
	const out: DeploymentConfig[] = [];
	for (const x of list) {
		if (!x || typeof x !== 'object') continue;
		const d = x as Record<string, unknown>;
		if (typeof d.chain_id !== 'string' || !CHAIN_ID.test(d.chain_id)) continue;
		if (typeof d.proxy !== 'string' || !ADDRESS.test(d.proxy)) continue;
		const hrp = typeof d.hrp === 'string' && /^[a-z]{1,16}$/.test(d.hrp) ? d.hrp : 'thor';
		if (!d.proxy.startsWith(hrp + '1')) continue;
		const cfg: DeploymentConfig = { chain_id: d.chain_id, proxy: d.proxy, hrp };
		if (typeof d.account_code_checksum === 'string' && HEX64.test(d.account_code_checksum)) cfg.account_code_checksum = d.account_code_checksum;
		if (typeof d.label === 'string') cfg.label = d.label.slice(0, 64);
		out.push(cfg);
	}
	return out;
}

/** The largest view-key file (errata E-66 (1): at most 1 MiB, plus one trailing newline). */
export const MAX_FILE_BYTES = 1024 * 1024 + 1;

/** E-48 / E-59: the two sources' tips may differ by at most this many blocks. */
export const MAX_TIP_SPREAD = 10;

/** Ozone's batch screening endpoint (same origin) and its batch limit. */
export const SCREEN_ENDPOINT = '/api/v1/screen';
export const SCREEN_BATCH = 100;
