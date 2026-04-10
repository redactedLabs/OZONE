import { db } from '$lib/server/db';
import { privacySnapshots } from '$lib/server/db/schema';
import { sql, desc, lte } from 'drizzle-orm';

const PROXY_ADDRESS = 'thor1c5nhsur6368rtt36f7lczjwjxp02kzc586vcqvx88ptep5au90sshaykqx';
const FEE_ADDRESS = 'thor15qymde6pkjxl2c068lk2gq0c7rcps4mckd3ngzwgy5n2mx6ms6mq3xntrt';
const THORNODE = 'https://gateway.liquify.com/chain/thorchain_api';
const MIDGARD = 'https://gateway.liquify.com/chain/thorchain_midgard';
const CODE_ID_PROXY = 133;
const CODE_ID_SUB = 134;

type BalanceResponse = {
	balances: Array<{ denom: string; amount: string }>;
};

type ContractsResponse = {
	contracts: string[];
	pagination: { next_key: string | null; total: string };
};

type StateResponse = {
	models: Array<{ key: string; value: string }>;
};

type Pool = {
	asset: string;
	assetPrice: string;
	assetPriceUSD: string;
};

function cleanAsset(asset: string): string {
	if (!asset) return '';
	let name = asset;
	if (name.includes('~')) name = name.split('~')[1];
	else if (name.includes('/')) name = name.split('/')[1];
	else if (name.includes('.')) name = name.split('.')[1];
	const dashParts = name.split('-');
	if (dashParts.length >= 3) return dashParts[1];
	if (dashParts.length === 2) {
		if (dashParts[1].length > 6) return dashParts[0];
		if (dashParts[0] === dashParts[1]) return dashParts[0];
		return dashParts[1];
	}
	return dashParts[0];
}

function parseRuneBalance(data: BalanceResponse): number {
	const rune = data.balances?.find((b) => b.denom === 'rune');
	return rune ? parseInt(rune.amount, 10) / 1e8 : 0;
}

function parseAllBalances(data: BalanceResponse): Array<{ asset: string; amount: number }> {
	const merged = new Map<string, number>();
	for (const b of data.balances || []) {
		const asset = b.denom === 'rune' ? 'RUNE' : cleanAsset(b.denom).toUpperCase();
		const raw = parseInt(b.amount || '0') / 1e8;
		if (raw === 0) continue;
		merged.set(asset, (merged.get(asset) || 0) + raw);
	}
	return Array.from(merged.entries()).map(([asset, amount]) => ({ asset, amount }));
}

function buildPriceMap(pools: Pool[], runePrice: number): Map<string, number> {
	const map = new Map<string, number>();
	map.set('RUNE', runePrice);
	for (const pool of pools) {
		const asset = cleanAsset(pool.asset).toUpperCase();
		const usd = parseFloat(pool.assetPriceUSD);
		if (usd > 0) map.set(asset, usd);
	}
	return map;
}

async function fetchJson<T>(url: string): Promise<T> {
	const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
	return res.json();
}

async function fetchProxyBalances(): Promise<Array<{ asset: string; amount: number }>> {
	const data = await fetchJson<BalanceResponse>(
		`${THORNODE}/cosmos/bank/v1beta1/balances/${PROXY_ADDRESS}`
	);
	return parseAllBalances(data);
}

async function fetchSubWallets(): Promise<string[]> {
	const all: string[] = [];
	let nextKey: string | null = null;

	do {
		const url = new URL(`${THORNODE}/cosmwasm/wasm/v1/code/${CODE_ID_SUB}/contracts`);
		url.searchParams.set('pagination.limit', '100');
		if (nextKey) url.searchParams.set('pagination.key', nextKey);

		const data = await fetchJson<ContractsResponse>(url.toString());
		all.push(...(data.contracts || []));
		nextKey = data.pagination?.next_key || null;
	} while (nextKey);

	return all;
}

async function fetchSubWalletBalances(addresses: string[]): Promise<Array<{ asset: string; amount: number }>> {
	if (addresses.length === 0) return [];

	const results = await Promise.allSettled(
		addresses.map((addr) =>
			fetchJson<BalanceResponse>(`${THORNODE}/cosmos/bank/v1beta1/balances/${addr}`)
		)
	);

	const merged = new Map<string, number>();
	for (const r of results) {
		if (r.status !== 'fulfilled') continue;
		for (const b of parseAllBalances(r.value)) {
			merged.set(b.asset, (merged.get(b.asset) || 0) + b.amount);
		}
	}
	return Array.from(merged.entries()).map(([asset, amount]) => ({ asset, amount }));
}

async function fetchContractState(): Promise<{
	fee: number;
	adminAddress: string;
	feeAddress: string;
	subWasmId: number;
}> {
	const data = await fetchJson<StateResponse>(
		`${THORNODE}/cosmwasm/wasm/v1/contract/${PROXY_ADDRESS}/state`
	);

	const defaults = { fee: 15, adminAddress: '', feeAddress: '', subWasmId: CODE_ID_SUB };

	if (!data.models?.length) return defaults;

	for (const model of data.models) {
		try {
			const decoded = JSON.parse(atob(model.value));
			if (decoded && typeof decoded === 'object') {
				return {
					fee: decoded.fee ?? decoded.protocol_fee ?? defaults.fee,
					adminAddress: decoded.admin_address ?? decoded.admin ?? defaults.adminAddress,
					feeAddress: decoded.fee_address ?? defaults.feeAddress,
					subWasmId: decoded.sub_wasm_id ?? decoded.sub_code_id ?? defaults.subWasmId
				};
			}
		} catch {
			// try next model
		}
	}

	return defaults;
}

async function fetchFeeBalance(): Promise<{ rune: number; all: Array<{ asset: string; amount: number }> }> {
	const data = await fetchJson<BalanceResponse>(
		`${THORNODE}/cosmos/bank/v1beta1/balances/${FEE_ADDRESS}`
	);
	return { rune: parseRuneBalance(data), all: parseAllBalances(data) };
}

type CosmosTxsResponse = {
	tx_responses?: Array<{
		txhash: string;
		events?: Array<{ type: string; attributes: Array<{ key: string; value: string }> }>;
		logs?: Array<{ events?: Array<{ type: string; attributes: Array<{ key: string; value: string }> }> }>;
	}>;
	pagination?: { next_key: string | null; total: string };
	total?: string;
};

// Some cosmos-sdk versions return event attribute keys/values base64-encoded.
function decodeAttr(s: string): string {
	if (!s) return '';
	if (/^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length % 4 === 0) {
		try {
			const decoded = atob(s);
			if (/^[\x20-\x7e]*$/.test(decoded)) return decoded;
		} catch {
			// fall through
		}
	}
	return s;
}

/**
 * Sum all incoming bank transfers to `addr` over the chain's entire history.
 * Used to compute lifetime cumulative fees, so the total persists even after
 * the admin sweeps the fee address.
 */
async function fetchCumulativeIncoming(addr: string): Promise<Array<{ asset: string; amount: number }>> {
	const merged = new Map<string, number>();
	const seenTxs = new Set<string>();
	const PAGE_SIZE = 100;
	const MAX_PAGES = 100; // safety cap: 10k txs
	let offset = 0;

	for (let page = 0; page < MAX_PAGES; page++) {
		const url =
			`${THORNODE}/cosmos/tx/v1beta1/txs` +
			`?events=${encodeURIComponent(`transfer.recipient='${addr}'`)}` +
			`&pagination.limit=${PAGE_SIZE}` +
			`&pagination.offset=${offset}`;

		let data: CosmosTxsResponse;
		try {
			data = await fetchJson<CosmosTxsResponse>(url);
		} catch {
			break;
		}

		const txResponses = data.tx_responses || [];
		if (txResponses.length === 0) break;

		for (const tx of txResponses) {
			if (seenTxs.has(tx.txhash)) continue;
			seenTxs.add(tx.txhash);

			// Prefer top-level events (cosmos-sdk 0.46+); fall back to logs[].events.
			let events = tx.events || [];
			if (events.length === 0 && tx.logs) {
				events = tx.logs.flatMap((log) => log.events || []);
			}

			for (const ev of events) {
				if (ev.type !== 'transfer') continue;
				let recipient = '';
				let amountStr = '';
				for (const attr of ev.attributes || []) {
					const k = decodeAttr(attr.key);
					const v = decodeAttr(attr.value);
					if (k === 'recipient') recipient = v;
					else if (k === 'amount') amountStr = v;
				}
				if (recipient !== addr || !amountStr) continue;

				// amount can be comma-separated coin list: "100rune,50btc-btc"
				for (const part of amountStr.split(',')) {
					const m = part.trim().match(/^(\d+)(.+)$/);
					if (!m) continue;
					const raw = parseInt(m[1], 10) / 1e8;
					if (raw === 0) continue;
					const denom = m[2];
					const asset = denom === 'rune' ? 'RUNE' : cleanAsset(denom).toUpperCase();
					merged.set(asset, (merged.get(asset) || 0) + raw);
				}
			}
		}

		if (txResponses.length < PAGE_SIZE) break;
		offset += PAGE_SIZE;
	}

	return Array.from(merged.entries()).map(([asset, amount]) => ({ asset, amount }));
}

async function fetchRunePrice(): Promise<{ runePrice: number; pools: Pool[] }> {
	const pools = await fetchJson<Pool[]>(`${MIDGARD}/v2/pools`);
	// Find a stable pool to derive RUNE price
	const btcPool = pools.find((p) => p.asset === 'BTC.BTC');
	if (btcPool) {
		const assetPrice = parseFloat(btcPool.assetPrice);
		const assetPriceUSD = parseFloat(btcPool.assetPriceUSD);
		if (assetPrice > 0) return { runePrice: assetPriceUSD / assetPrice, pools };
	}
	// Fallback: try any pool
	for (const pool of pools) {
		const ap = parseFloat(pool.assetPrice);
		const apUsd = parseFloat(pool.assetPriceUSD);
		if (ap > 0 && apUsd > 0) return { runePrice: apUsd / ap, pools };
	}
	return { runePrice: 0, pools };
}

export async function load() {
	const [proxyResult, subWalletsResult, configResult, priceResult, feeResult] = await Promise.allSettled([
		fetchProxyBalances(),
		fetchSubWallets(),
		fetchContractState(),
		fetchRunePrice(),
		fetchFeeBalance()
	]);

	const proxyBalances = proxyResult.status === 'fulfilled' ? proxyResult.value : [];
	const subWallets = subWalletsResult.status === 'fulfilled' ? subWalletsResult.value : [];
	const config =
		configResult.status === 'fulfilled'
			? configResult.value
			: { fee: 15, adminAddress: '', feeAddress: '', subWasmId: CODE_ID_SUB };
	const priceData = priceResult.status === 'fulfilled' ? priceResult.value : { runePrice: 0, pools: [] };
	const runePriceUsd = priceData.runePrice;
	const priceMap = buildPriceMap(priceData.pools, runePriceUsd);
	const feeData = feeResult.status === 'fulfilled' ? feeResult.value : { rune: 0, all: [] };
	const feeBalance = feeData.rune;

	// Current (un-swept) fee balance — used as a fallback if we don't yet have
	// cumulative data, and stored alongside cumulative for backward compat.
	const currentFeeAssets = feeData.all
		.map((b) => ({
			asset: b.asset,
			amount: b.amount,
			usd: b.amount * (priceMap.get(b.asset) || 0)
		}))
		.sort((a, b) => b.usd - a.usd);
	const currentFeeBalanceUsd = currentFeeAssets.reduce((sum, a) => sum + a.usd, 0);

	// Fetch sub-wallet balances (all assets)
	let subBalances: Array<{ asset: string; amount: number }> = [];
	try {
		subBalances = await fetchSubWalletBalances(subWallets);
	} catch {
		// keep empty
	}

	// Merge proxy + sub-wallet balances into TVL assets
	const tvlMerged = new Map<string, number>();
	for (const b of [...proxyBalances, ...subBalances]) {
		tvlMerged.set(b.asset, (tvlMerged.get(b.asset) || 0) + b.amount);
	}
	const tvlAssets = Array.from(tvlMerged.entries())
		.map(([asset, amount]) => ({
			asset,
			amount,
			usd: amount * (priceMap.get(asset) || 0)
		}))
		.sort((a, b) => b.usd - a.usd);

	const totalTVLUsd = tvlAssets.reduce((sum, a) => sum + a.usd, 0);

	// --- Snapshot + 1d change logic ---
	let tvlChange: number | null = null;
	let walletChange: number | null = null;
	let revenueChange: number | null = null;
	let volumeChange: number | null = null;
	let cumulativeFeesAssets: Array<{ asset: string; amount: number }> | null = null;
	let cumulativeVolumeAssets: Array<{ asset: string; amount: number }> | null = null;

	const sumUsd = (arr: Array<{ asset: string; amount: number }>) =>
		arr.reduce((s, a) => s + a.amount * (priceMap.get(a.asset) || 0), 0);

	try {
		// Rate-limit: only insert if no snapshot in last 10 minutes
		const recent = await db
			.select({ id: privacySnapshots.id })
			.from(privacySnapshots)
			.where(sql`${privacySnapshots.createdAt} > now() - interval '10 minutes'`)
			.limit(1);

		if (recent.length === 0) {
			// Heavy fetch only on snapshot insert (~ once per 10 min). Both fees
			// and volume scans run in parallel. Falls back gracefully on failure.
			const [feesResult, volumeResult] = await Promise.allSettled([
				fetchCumulativeIncoming(FEE_ADDRESS),
				fetchCumulativeIncoming(PROXY_ADDRESS)
			]);

			if (feesResult.status === 'fulfilled' && feesResult.value.length > 0) {
				cumulativeFeesAssets = feesResult.value;
			} else {
				// Fall back: use current balance as cumulative for fees.
				cumulativeFeesAssets = currentFeeAssets.map((a) => ({ asset: a.asset, amount: a.amount }));
			}
			if (volumeResult.status === 'fulfilled' && volumeResult.value.length > 0) {
				cumulativeVolumeAssets = volumeResult.value;
			}

			const cumFeesUsd = sumUsd(cumulativeFeesAssets);
			const cumVolumeUsd = cumulativeVolumeAssets ? sumUsd(cumulativeVolumeAssets) : 0;

			await db.insert(privacySnapshots).values({
				tvlUsd: totalTVLUsd.toString(),
				walletCount: subWallets.length,
				revenueUsd: currentFeeBalanceUsd.toString(),
				cumulativeFeesUsd: cumFeesUsd.toString(),
				cumulativeFeesAssets: cumulativeFeesAssets ?? undefined,
				cumulativeVolumeUsd: cumVolumeUsd.toString(),
				cumulativeVolumeAssets: cumulativeVolumeAssets ?? undefined
			});
		} else {
			// Read latest snapshot for cached cumulative fees + volume
			const latest = await db
				.select()
				.from(privacySnapshots)
				.orderBy(desc(privacySnapshots.createdAt))
				.limit(1);
			if (latest.length > 0) {
				if (latest[0].cumulativeFeesAssets) {
					cumulativeFeesAssets = latest[0].cumulativeFeesAssets as Array<{ asset: string; amount: number }>;
				}
				if (latest[0].cumulativeVolumeAssets) {
					cumulativeVolumeAssets = latest[0].cumulativeVolumeAssets as Array<{ asset: string; amount: number }>;
				}
			}
		}

		// Find snapshot from ~24h ago
		const old = await db
			.select()
			.from(privacySnapshots)
			.where(lte(privacySnapshots.createdAt, sql`now() - interval '24 hours'`))
			.orderBy(desc(privacySnapshots.createdAt))
			.limit(1);

		if (old.length > 0) {
			const oldTvl = parseFloat(old[0].tvlUsd);
			const oldWallets = old[0].walletCount;
			// Prefer cumulative for revenue change; fall back to revenueUsd for old rows.
			const oldRevenue = parseFloat(old[0].cumulativeFeesUsd ?? old[0].revenueUsd);

			if (oldTvl > 0) tvlChange = ((totalTVLUsd - oldTvl) / oldTvl) * 100;
			walletChange = subWallets.length - oldWallets;

			if (oldRevenue > 0) {
				const newRevenue = cumulativeFeesAssets ? sumUsd(cumulativeFeesAssets) : currentFeeBalanceUsd;
				revenueChange = ((newRevenue - oldRevenue) / oldRevenue) * 100;
			}

			// Volume change from real cumulative volume snapshots (when available)
			const oldVolumeStr = old[0].cumulativeVolumeUsd;
			if (oldVolumeStr && cumulativeVolumeAssets) {
				const oldVolume = parseFloat(oldVolumeStr);
				if (oldVolume > 0) {
					const newVolume = sumUsd(cumulativeVolumeAssets);
					volumeChange = ((newVolume - oldVolume) / oldVolume) * 100;
				}
			}
		}
	} catch {
		// DB errors shouldn't break the page
	}

	// Display values: prefer cumulative (lifetime) over current balance.
	const feeAssets = cumulativeFeesAssets
		? cumulativeFeesAssets
				.map((a) => ({
					asset: a.asset,
					amount: a.amount,
					usd: a.amount * (priceMap.get(a.asset) || 0)
				}))
				.sort((a, b) => b.usd - a.usd)
		: currentFeeAssets;
	const feeBalanceUsd = feeAssets.reduce((sum, a) => sum + a.usd, 0);

	// Total volume: prefer real on-chain cumulative incoming to the proxy. Fall
	// back to fees ÷ fee rate when we don't have a snapshot yet.
	const feeRate = config.fee > 0 ? config.fee / 10000 : 0;
	const volumeAssets = cumulativeVolumeAssets
		? cumulativeVolumeAssets
				.map((a) => ({
					asset: a.asset,
					amount: a.amount,
					usd: a.amount * (priceMap.get(a.asset) || 0)
				}))
				.sort((a, b) => b.usd - a.usd)
		: feeRate > 0
			? feeAssets.map((a) => ({
					asset: a.asset,
					amount: a.amount / feeRate,
					usd: a.usd / feeRate
				}))
			: [];
	const totalVolumeUsd = volumeAssets.reduce((sum, a) => sum + a.usd, 0);
	const volumeIsReal = cumulativeVolumeAssets !== null;

	// Fall back to revenue change if we don't yet have a 24h-old volume snapshot.
	if (volumeChange === null) volumeChange = revenueChange;

	return {
		subWalletCount: subWallets.length,
		totalTVLUsd,
		tvlAssets,
		feeBalance,
		feeBalanceUsd,
		feeAssets,
		totalVolumeUsd,
		volumeAssets,
		volumeIsReal,
		runePriceUsd,
		config,
		proxyAddress: PROXY_ADDRESS,
		feeAddress: FEE_ADDRESS,
		codeIdProxy: CODE_ID_PROXY,
		codeIdSub: CODE_ID_SUB,
		fetchedAt: new Date().toISOString(),
		tvlChange,
		walletChange,
		revenueChange,
		volumeChange
	};
}
