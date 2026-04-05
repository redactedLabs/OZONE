/**
 * Dynamic token/chain logo resolution.
 *
 * Primary:  SwapKit GCS CDN — uses THORChain asset identifiers directly (lowercased).
 * Fallback: cryptocurrency-icons CDN + CoinMarketCap for known tokens.
 *
 * Pools are fetched from Midgard (Liquify) once and cached client-side for the session.
 */

const SWAPKIT_CDN = 'https://storage.googleapis.com/token-list-swapkit/images';
const ICON_CDN = 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color';
const CMC_CDN = 'https://s2.coinmarketcap.com/static/img/coins/64x64';
const MIDGARD_POOLS = 'https://gateway.liquify.com/chain/thorchain_midgard/v2/pools';

// Official RUJI logo from CoinGecko
const RUJI_LOGO = 'https://coin-images.coingecko.com/coins/images/55372/small/RUJI_180x180.png';

// Static fallbacks for tokens that might not resolve via SwapKit
export const STATIC_LOGOS: Record<string, string> = {
	BTC: `${ICON_CDN}/btc.svg`,
	ETH: `${ICON_CDN}/eth.svg`,
	SOL: `${CMC_CDN}/5426.png`,
	DOGE: `${ICON_CDN}/doge.svg`,
	LTC: `${ICON_CDN}/ltc.svg`,
	BCH: `${ICON_CDN}/bch.svg`,
	AVAX: `${ICON_CDN}/avax.svg`,
	BNB: `${ICON_CDN}/bnb.svg`,
	ATOM: `${ICON_CDN}/atom.svg`,
	XRP: `${ICON_CDN}/xrp.svg`,
	RUNE: `${CMC_CDN}/4157.png`,
	USDC: `${ICON_CDN}/usdc.svg`,
	USDT: `${ICON_CDN}/usdt.svg`,
	DAI: `${ICON_CDN}/dai.svg`,
	WBTC: `${ICON_CDN}/wbtc.svg`,
	AAVE: `${CMC_CDN}/7278.png`,
	XMR: `${CMC_CDN}/328.png`,
	ZEC: `${ICON_CDN}/zec.svg`,
	DASH: `${ICON_CDN}/dash.svg`,
	ETC: `${ICON_CDN}/etc.svg`,
	TRX: `${ICON_CDN}/trx.svg`,
	LINK: `${ICON_CDN}/link.svg`,
	UNI: `${CMC_CDN}/7083.png`,
	SUSHI: `${CMC_CDN}/6758.png`,
	YFI: `${CMC_CDN}/5864.png`,
	COMP: `${CMC_CDN}/5692.png`,
	SNX: `${CMC_CDN}/2586.png`,
	RUJI: RUJI_LOGO,
};

// Default chain color for unknown chains
const DEFAULT_CHAIN_COLOR = 'background: rgba(100,100,100,0.15); border: 1px solid rgba(100,100,100,0.3)';

export const CHAIN_COLORS: Record<string, string> = {
	BTC: 'background: rgba(247, 147, 26, 0.15); border: 1px solid rgba(247, 147, 26, 0.3)',
	ETH: 'background: rgba(98, 126, 234, 0.15); border: 1px solid rgba(98, 126, 234, 0.3)',
	SOL: 'background: rgba(153, 69, 255, 0.15); border: 1px solid rgba(153, 69, 255, 0.3)',
	DOGE: 'background: rgba(196, 164, 48, 0.15); border: 1px solid rgba(196, 164, 48, 0.3)',
	LTC: 'background: rgba(191, 191, 191, 0.15); border: 1px solid rgba(191, 191, 191, 0.3)',
	BCH: 'background: rgba(78, 193, 97, 0.15); border: 1px solid rgba(78, 193, 97, 0.3)',
	AVAX: 'background: rgba(232, 65, 66, 0.15); border: 1px solid rgba(232, 65, 66, 0.3)',
	BSC: 'background: rgba(243, 186, 47, 0.15); border: 1px solid rgba(243, 186, 47, 0.3)',
	BNB: 'background: rgba(243, 186, 47, 0.15); border: 1px solid rgba(243, 186, 47, 0.3)',
	BASE: 'background: rgba(0, 82, 255, 0.15); border: 1px solid rgba(0, 82, 255, 0.3)',
	GAIA: 'background: rgba(109, 117, 242, 0.15); border: 1px solid rgba(109, 117, 242, 0.3)',
	TRON: 'background: rgba(255, 0, 19, 0.15); border: 1px solid rgba(255, 0, 19, 0.3)',
	TRX: 'background: rgba(255, 0, 19, 0.15); border: 1px solid rgba(255, 0, 19, 0.3)',
	XRP: 'background: rgba(0, 170, 228, 0.15); border: 1px solid rgba(0, 170, 228, 0.3)',
	THOR: 'background: rgba(46, 204, 113, 0.15); border: 1px solid rgba(46, 204, 113, 0.3)',
	XMR: 'background: rgba(255, 102, 0, 0.15); border: 1px solid rgba(255, 102, 0, 0.3)',
	ZEC: 'background: rgba(236, 178, 43, 0.15); border: 1px solid rgba(236, 178, 43, 0.3)',
	DASH: 'background: rgba(0, 141, 228, 0.15); border: 1px solid rgba(0, 141, 228, 0.3)',
};

export function getChainColor(chain: string): string {
	return CHAIN_COLORS[chain] || DEFAULT_CHAIN_COLOR;
}

/** Session-level cache */
let poolAssetsCache: string[] | null = null;
let poolChainsCache: string[] | null = null;

/**
 * Fetch active pool assets from Midgard (Liquify). Cached for the page session.
 * Returns asset identifiers like ["BTC.BTC", "ETH.ETH", "ETH.USDC-0xA0B..."]
 */
export async function fetchPoolAssets(): Promise<string[]> {
	if (poolAssetsCache) return poolAssetsCache;
	try {
		const res = await fetch(MIDGARD_POOLS);
		if (!res.ok) return [];
		const pools: Array<{ asset: string; status: string }> = await res.json();
		poolAssetsCache = pools.map((p) => p.asset);
		return poolAssetsCache;
	} catch {
		return [];
	}
}

/**
 * Get all unique chains from active Midgard pools.
 * Returns e.g. ["BTC", "ETH", "SOL", "DOGE", "XMR", ...]
 */
export async function fetchPoolChains(): Promise<string[]> {
	if (poolChainsCache) return poolChainsCache;
	const assets = await fetchPoolAssets();
	const chains = new Set<string>();
	for (const asset of assets) {
		const dot = asset.indexOf('.');
		if (dot > 0) chains.add(asset.slice(0, dot));
	}
	// Always include THOR
	chains.add('THOR');
	poolChainsCache = [...chains].sort();
	return poolChainsCache;
}

/**
 * Get the SwapKit CDN URL for a THORChain asset identifier.
 * e.g. "BTC.BTC" → "https://storage.googleapis.com/token-list-swapkit/images/btc.btc.png"
 */
function swapKitUrl(thorAsset: string): string {
	return `${SWAPKIT_CDN}/${thorAsset.toLowerCase()}.png`;
}

/**
 * Synchronous logo lookup — returns the best URL without network validation.
 * Use this in reactive UI code where you can't await.
 *
 * Priority: SwapKit CDN (if poolAssets provided) → static fallback → undefined
 */
export function getTokenLogoSync(symbol: string, poolAssets?: string[]): string | undefined {
	const upper = symbol.toUpperCase();

	// Check static first for known tokens (fast, reliable)
	if (STATIC_LOGOS[upper]) return STATIC_LOGOS[upper];

	// Try SwapKit CDN via pool asset match
	if (poolAssets && poolAssets.length > 0) {
		const nativeMatch = poolAssets.find((a) => {
			const parts = a.split('.');
			return parts.length === 2 && parts[1].split('-')[0] === upper;
		});
		if (nativeMatch) return swapKitUrl(nativeMatch);
	}

	return undefined;
}

/**
 * Get chain logo URL.
 */
export function getChainLogo(chain: string, poolAssets?: string[]): string | undefined {
	const upper = chain.toUpperCase();

	// Map THORChain chain names to their native token symbols for STATIC_LOGOS lookup
	const chainToToken: Record<string, string> = {
		GAIA: 'ATOM', BSC: 'BNB', TRON: 'TRX', THOR: 'RUNE',
	};
	const tokenSymbol = chainToToken[upper] || upper;

	if (STATIC_LOGOS[tokenSymbol]) return STATIC_LOGOS[tokenSymbol];

	// Try SwapKit CDN
	if (poolAssets && poolAssets.length > 0) {
		const found = poolAssets.find((a) => a.startsWith(upper + '.') && !a.split('.')[1]?.includes('-'));
		if (found) return swapKitUrl(found);
	}

	return undefined;
}
