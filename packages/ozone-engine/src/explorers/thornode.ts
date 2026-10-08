/**
 * THORNode endpoints, and THORChain's current inbound vault and router
 * addresses (THORNode /thorchain/inbound_addresses): never followed or listed
 * by a cluster expansion or a look-back. Historical vaults are caught by the
 * service rule (their transaction counts are huge); routers by the contract
 * rule.
 *
 * THORNode is read from Redacted's own node first (api.redacted.money: the
 * read-only Cosmos LCD / THORNode API, 20 requests/s with bursts of 40 per IP)
 * with Liquify's public gateway as the fallback (FailoverJson). Configured
 * values that name a known public gateway (ninerealms is sunsetting, Liquify's
 * free gateway is metered) are mapped to ours; any other explicit value is
 * kept, with the public gateway behind it.
 */
import { parseForChain } from '../../../ozone-client/src/index.js';
import { FailoverJson } from '../util/failover.js';
import { httpJson, type HttpOptions } from '../util/http.js';

/** Redacted's own THORNode API (read-only). */
export const REDACTED_THORNODE_API = 'https://api.redacted.money';
/** Redacted's own CometBFT RPC (read-only GET paths; no websocket). */
export const REDACTED_THORNODE_RPC = 'https://rpc.redacted.money';
/** Liquify's public gateways: the fallbacks. */
export const LIQUIFY_THORNODE_API = 'https://gateway.liquify.com/chain/thorchain_api';
export const LIQUIFY_THORNODE_RPC = 'https://gateway.liquify.com/chain/thorchain_rpc';
export const LIQUIFY_THORNODE_WS = 'wss://gateway.liquify.com/chain/thorchain_rpc/websocket';

/** The first THORNode API endpoint tried (kept for callers that need one URL). */
export const DEFAULT_THORNODE_URL = REDACTED_THORNODE_API;

/** Public THORNode API gateways a configuration may still name: mapped to ours (with the fallback). */
export const PUBLIC_THORNODE_APIS: readonly string[] = [
	'https://thornode.ninerealms.com',
	'http://thornode.ninerealms.com',
	'https://thornode-v1.ninerealms.com',
	'https://thornode-v2.ninerealms.com',
	LIQUIFY_THORNODE_API,
	'https://thornode.thorchain.liquify.com',
	'https://thornode-api.thorchain.liquify.com'
];

/** Public CometBFT RPC gateways (HTTP and websocket forms). */
export const PUBLIC_THORNODE_RPCS: readonly string[] = [
	'https://rpc.ninerealms.com',
	'http://rpc.ninerealms.com',
	'wss://rpc.ninerealms.com/websocket',
	'ws://rpc.ninerealms.com/websocket',
	LIQUIFY_THORNODE_RPC,
	LIQUIFY_THORNODE_WS,
	'https://rpc.thorchain.liquify.com',
	'wss://rpc.thorchain.liquify.com/websocket'
];

const norm = (u: string) => u.trim().replace(/\/+$/, '');

/**
 * The THORNode API endpoints to use, best first, for a configured value
 * (THORNODE_URL): unset or a known public gateway → ours, then Liquify; any
 * other value → that value, then Liquify.
 */
export function thornodeApiUrls(configured: string | undefined = process.env.THORNODE_URL): string[] {
	const v = configured ? norm(configured) : '';
	if (!v || v === REDACTED_THORNODE_API || PUBLIC_THORNODE_APIS.includes(v)) return [REDACTED_THORNODE_API, LIQUIFY_THORNODE_API];
	return v === LIQUIFY_THORNODE_API ? [v] : [v, LIQUIFY_THORNODE_API];
}

/**
 * A THORNode API client over `urls` (default thornodeApiUrls()), with a
 * per-endpoint rate limit: ours at 5 requests/s (a quarter of its public
 * limit), the gateway at about 3/s.
 */
export function thornodeClient(opts: { urls?: string[]; http?: HttpOptions; minIntervalMs?: number } = {}): FailoverJson {
	return new FailoverJson({
		urls: opts.urls ?? thornodeApiUrls(),
		minIntervalMs: opts.minIntervalMs ?? 350,
		intervals: opts.minIntervalMs !== undefined ? {} : { [REDACTED_THORNODE_API]: 200 },
		http: opts.http
	});
}

let cache: { at: number; addresses: Set<string> } | undefined;

/** Canonical addresses (lower-case for EVM) of every current THORChain vault and router; empty when THORNode is unreachable. */
export async function thorchainInbound(opts: { baseUrl?: string; http?: HttpOptions; maxAgeMs?: number } = {}): Promise<Set<string>> {
	if (cache && Date.now() - cache.at < (opts.maxAgeMs ?? 3600_000)) return cache.addresses;
	const out = new Set<string>();
	try {
		const list = opts.baseUrl
			? await httpJson<Array<{ chain?: string; address?: string; router?: string }>>(`${norm(opts.baseUrl)}/thorchain/inbound_addresses`, {
					timeoutMs: 30_000,
					retries: 1,
					...opts.http
				})
			: await thornodeClient({ http: opts.http }).get<Array<{ chain?: string; address?: string; router?: string }>>('/thorchain/inbound_addresses', { timeoutMs: 30_000 });
		for (const row of Array.isArray(list) ? list : []) {
			for (const a of [row.address, row.router]) {
				if (!a || !row.chain) continue;
				const p = parseForChain(a, row.chain.toUpperCase());
				if (p) out.add(p.address);
			}
		}
		cache = { at: Date.now(), addresses: out };
	} catch {
		// best effort: the service and contract rules still apply
	}
	return out;
}

/** Tests. */
export function resetThorchainInboundCache(): void {
	cache = undefined;
}
