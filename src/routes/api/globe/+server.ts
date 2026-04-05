import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const MIDGARD_URLS = [
	'https://gateway.liquify.com/chain/thorchain_midgard',
	'https://midgard.ninerealms.com',
];

const cleanAsset = (asset: string) => {
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
};

const typeMap: Record<string, string> = {
	swap: 'SWAP', addLiquidity: 'ADD', withdraw: 'WD', send: 'SEND', refund: 'REFUND',
};

function parseAction(a: any) {
	if (!a) return null;
	const ins = a.in || [];
	const outs = a.out || [];
	const fromAddr = ins[0]?.address || '';
	const toAddr = outs[0]?.address || fromAddr;
	const coinsIn = ins[0]?.coins?.[0] || {};
	const coinsOut = outs[0]?.coins?.[0] || {};
	const assetIn = coinsIn.asset || '';
	const assetOut = coinsOut.asset || '';
	const amountIn = coinsIn.amount ? (parseInt(coinsIn.amount) / 1e8) : 0;

	// Skip dust RUNE transactions
	if (amountIn < 0.01 && assetIn.includes('RUNE')) return null;
	// Skip if no from address at all
	if (!fromAddr) return null;

	const truncAddr = (addr: string) => addr.length > 20 ? addr.slice(0, 8) + '...' + addr.slice(-4) : addr;
	const txID = ins[0]?.txID || '';

	// Determine swap subtype
	const meta = a.metadata || {};
	const swapMeta = meta.swap || {};
	const isStreaming = swapMeta.isStreamingSwap === true;
	let type = typeMap[a.type] || a.type?.toUpperCase() || '?';
	if (type === 'SWAP' && isStreaming) type = 'STREAM';

	return {
		type,
		from: truncAddr(fromAddr),
		to: truncAddr(toAddr),
		fromFull: fromAddr,
		toFull: toAddr,
		assetIn: cleanAsset(assetIn),
		assetOut: cleanAsset(assetOut),
		amount: amountIn > 10000 ? `${(amountIn / 1000).toFixed(0)}k` : amountIn > 1000 ? `${(amountIn / 1000).toFixed(1)}k` : amountIn > 1 ? amountIn.toFixed(1) : amountIn > 0.01 ? amountIn.toFixed(3) : '',
		time: a.date ? new Date(parseInt(a.date) / 1e6).toISOString() : null,
		txID,
	};
}

export const GET: RequestHandler = async () => {
	// Try each Midgard endpoint until one works
	for (const baseUrl of MIDGARD_URLS) {
		try {
			const res = await fetch(
				`${baseUrl}/v2/actions?limit=20&type=swap,addLiquidity,withdraw,send`,
				{
					headers: {
						'Accept': 'application/json',
						'User-Agent': 'RedactedCompliance/1.0',
					},
				}
			);

			if (!res.ok) continue;

			const data: any = await res.json();
			const actions = data?.actions || [];
			if (actions.length === 0) continue;

			const txs = actions.map(parseAction).filter(Boolean).slice(0, 20);
			return json(txs);
		} catch {
			// Try next endpoint
			continue;
		}
	}

	// All endpoints failed
	return json([]);
};
