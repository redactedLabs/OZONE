/**
 * USD prices for flows whose Midgard metadata carries no price (sends,
 * withdrawals, LP deposits). Swap flows use the action's own inPriceUSD /
 * outPriceUSD (the price at the time). Other flows use the current pool
 * price — an approximation, stated as such on the methodology page; it only
 * decides whether a flow is above the dust threshold.
 */
import type { MidgardLike as Midgard } from './midgard.js';

export interface PriceOracle {
	priceUsd(asset: string): number | undefined;
}

/** `BTC~BTC` (trade), `BTC/BTC` (synth), `BTC-BTC` (secured) → `BTC.BTC`. */
export function l1Asset(asset: string): string {
	const up = asset.toUpperCase();
	const m = /^([A-Z0-9]+)[~/](.+)$/.exec(up);
	if (m) return `${m[1]}.${m[2]}`;
	const s = /^([A-Z0-9]+)-([A-Z0-9]+(?:-0X[0-9A-F]+)?)$/.exec(up);
	if (s && !up.includes('.')) return `${s[1]}.${s[2]}`;
	return up;
}

export class StaticPrices implements PriceOracle {
	constructor(private readonly prices: Map<string, number>) {}
	priceUsd(asset: string): number | undefined {
		const a = l1Asset(asset);
		return this.prices.get(a) ?? (a === 'THOR.RUNE' ? this.prices.get('THOR.RUNE') : undefined);
	}
}

export async function loadPoolPrices(midgard: Midgard): Promise<StaticPrices> {
	const m = new Map<string, number>();
	const pools = await midgard.pools();
	for (const p of pools) {
		const price = Number(p.assetPriceUSD);
		if (price > 0) m.set(p.asset.toUpperCase(), price);
	}
	const rune = await midgard.runePriceUsd().catch(() => 0);
	if (rune > 0) m.set('THOR.RUNE', rune);
	return new StaticPrices(m);
}
