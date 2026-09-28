/**
 * THORChain's current inbound vault and router addresses (THORNode
 * /thorchain/inbound_addresses): never followed or listed by a cluster
 * expansion or a look-back. Historical vaults are caught by the service
 * rule (their transaction counts are huge); routers by the contract rule.
 */
import { parseForChain } from '../../../ozone-client/src/index.js';
import { httpJson, type HttpOptions } from '../util/http.js';

export const DEFAULT_THORNODE_URL = 'https://gateway.liquify.com/chain/thorchain_api';

let cache: { at: number; addresses: Set<string> } | undefined;

/** Canonical addresses (lower-case for EVM) of every current THORChain vault and router; empty when THORNode is unreachable. */
export async function thorchainInbound(opts: { baseUrl?: string; http?: HttpOptions; maxAgeMs?: number } = {}): Promise<Set<string>> {
	if (cache && Date.now() - cache.at < (opts.maxAgeMs ?? 3600_000)) return cache.addresses;
	const out = new Set<string>();
	try {
		const list = await httpJson<Array<{ chain?: string; address?: string; router?: string }>>(
			`${(opts.baseUrl ?? process.env.THORNODE_URL ?? DEFAULT_THORNODE_URL).replace(/\/+$/, '')}/thorchain/inbound_addresses`,
			{ timeoutMs: 30_000, retries: 1, ...opts.http }
		);
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
