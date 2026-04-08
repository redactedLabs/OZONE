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

	// Build fee assets with USD values, sorted by USD descending
	const feeAssets = feeData.all
		.map((b) => ({
			asset: b.asset,
			amount: b.amount,
			usd: b.amount * (priceMap.get(b.asset) || 0)
		}))
		.sort((a, b) => b.usd - a.usd);

	const feeBalanceUsd = feeAssets.reduce((sum, a) => sum + a.usd, 0);

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

	return {
		subWalletCount: subWallets.length,
		totalTVLUsd,
		tvlAssets,
		feeBalance,
		feeBalanceUsd,
		feeAssets,
		runePriceUsd,
		config,
		proxyAddress: PROXY_ADDRESS,
		feeAddress: FEE_ADDRESS,
		codeIdProxy: CODE_ID_PROXY,
		codeIdSub: CODE_ID_SUB,
		fetchedAt: new Date().toISOString()
	};
}
