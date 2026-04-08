import { getContractLabel, getContract, isContract } from '$lib/utils/rujiraContracts';
import { INTERNAL_TYPES } from '$lib/utils/historyTypes';
import type { HistoryTransaction, HistoryGroup } from '$lib/utils/historyTypes';

const MIDGARD_URL = 'https://gateway.liquify.com/chain/thorchain_midgard';
const THORNODE_URL = 'https://gateway.liquify.com/chain/thorchain_api';

// ── Asset / amount helpers ──

export function cleanAsset(asset: string): string {
	if (!asset) return '';

	// Known full denoms
	const lower = asset.toLowerCase();
	if (lower === 'rune' || lower === 'thor.rune') return 'RUNE';

	let name = asset;

	// Strip x/ share/receipt prefix (e.g., x/ghost-vault/avax-usdc-0x...)
	if (/^x\//i.test(name)) name = name.substring(2);

	// Take last segment after / (handles factory/, ibc/, ghost-vault/, synths)
	if (name.includes('/')) {
		const parts = name.split('/');
		name = parts[parts.length - 1];
	}

	// Strip trade/secured asset chain prefix (ETH~ETH → ETH)
	if (name.includes('~')) name = name.split('~').pop()!;

	// Strip L1 chain prefix (ETH.ETH → ETH, thor.lqdy-btc → lqdy-btc)
	if (name.includes('.')) name = name.split('.').pop()!;

	const dashParts = name.split('-');

	if (dashParts.length >= 3) {
		// Pattern: chain-ticker-address (e.g., avax-usdc-0xb97...)
		// Second part is typically the ticker
		const candidate = dashParts[1];
		if (candidate.length <= 6 && !/^[0-9a-f]+$/i.test(candidate)) {
			return candidate.toUpperCase();
		}
		return dashParts[0].toUpperCase();
	}

	if (dashParts.length === 2) {
		const first = dashParts[0].toUpperCase();
		const second = dashParts[1].toUpperCase();
		// If second part is a contract address, first is the ticker
		if (dashParts[1].length > 6 || /^0x/i.test(dashParts[1])) {
			return first;
		}
		// Cosmos denom chain-asset format (gaia-atom, base-eth, bsc-bnb)
		const CHAINS = new Set(['ETH', 'BTC', 'AVAX', 'BSC', 'BASE', 'GAIA', 'TRON', 'DOGE', 'LTC', 'BCH', 'XRP', 'SOL', 'TERRA', 'BNB', 'THOR']);
		if (CHAINS.has(first) && first !== second) {
			return second;
		}
		return first;
	}

	// Single part — uppercase and filter junk
	const result = dashParts[0].toUpperCase();
	if (result.startsWith('0X') || (result.startsWith('THOR1') && result.length > 10)) return '';
	if (result.length > 20 && /^[A-F0-9]+$/.test(result)) return ''; // IBC hash
	return result;
}

export function formatAmount(raw: string): string {
	if (!raw) return '0';
	const n = parseInt(raw) / 1e8;
	if (n === 0) return '0';
	if (n > 10000) return `${(n / 1000).toFixed(1)}k`;
	if (n > 1) return n.toFixed(2);
	if (n > 0.001) return n.toFixed(4);
	if (n > 0.000001) return n.toFixed(6);
	return n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

export function rawAmount(raw: string): string {
	if (!raw) return '0';
	const n = parseInt(raw) / 1e8;
	if (n === 0) return '0';
	return n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

// ── Rujira contract type mapping ──

const RUJIRA_TYPE_MAP: Record<string, { type: string; label: string }> = {
	// FIN — Orderbook DEX
	'wasm-rujira-fin/trade':              { type: 'fin-trade',       label: 'Trade (Orderbook)' },
	'wasm-rujira-fin/arb':                { type: 'fin-arb',         label: 'Arb' },
	'wasm-rujira-fin/order.create':       { type: 'fin-order',       label: 'Limit Order' },
	'wasm-rujira-fin/order.withdraw':     { type: 'fin-order-wd',    label: 'Claim Order' },
	'wasm-rujira-fin/order.increase':     { type: 'fin-order-inc',   label: 'Increase Order' },
	'wasm-rujira-fin/order.retract':      { type: 'fin-order-dec',   label: 'Cancel Order' },
	'wasm-rujira-fin/market-maker.fee':   { type: 'fin-mm-fee',      label: 'MM Fee' },
	// FIN Range — Concentrated Liquidity
	'wasm-rujira-fin/range.create':       { type: 'fin-range',       label: 'Range Create' },
	'wasm-rujira-fin/range.deposit':      { type: 'fin-range-dep',   label: 'Range Deposit' },
	'wasm-rujira-fin/range.withdraw':     { type: 'fin-range-wd',    label: 'Range Withdraw' },
	'wasm-rujira-fin/range.claim':        { type: 'fin-range-claim', label: 'Range Claim' },
	'wasm-rujira-fin/range.close':        { type: 'fin-range-close', label: 'Range Close' },
	'wasm-rujira-fin/range.transfer':     { type: 'fin-range-xfer',  label: 'Range Transfer' },
	'wasm-rujira-fin/range.fee':          { type: 'fin-range-fee',   label: 'Range Fee' },
	// BOW — AMM Pools
	'wasm-rujira-bow/swap':               { type: 'bow-swap',        label: 'AMM Swap' },
	'wasm-rujira-bow/deposit':            { type: 'bow-deposit',     label: 'AMM Deposit' },
	'wasm-rujira-bow/withdraw':           { type: 'bow-withdraw',    label: 'AMM Withdraw' },
	// TC Swap — THORChain Base Layer
	'wasm-rujira-thorchain-swap/swap':    { type: 'tc-swap',         label: 'Market Order' },
	// GHOST Vault — Lending
	'wasm-rujira-ghost-vault/borrow':     { type: 'ghost-borrow',    label: 'Borrow' },
	'wasm-rujira-ghost-vault/repay':      { type: 'ghost-repay',     label: 'Repay' },
	'wasm-rujira-ghost-vault/deposit':    { type: 'ghost-lend',      label: 'Lend' },
	'wasm-rujira-ghost-vault/withdraw':   { type: 'ghost-withdraw',  label: 'Withdraw Lend' },
	// GHOST Credit — Credit Accounts
	'wasm-rujira-ghost-credit/account.create':       { type: 'ghost-credit-create', label: 'Credit Account' },
	'wasm-rujira-ghost-credit/account.msg':          { type: 'ghost-credit-action', label: 'Credit Action' },
	'wasm-rujira-ghost-credit/account.msg/borrow':   { type: 'ghost-credit-borrow', label: 'Credit Borrow' },
	'wasm-rujira-ghost-credit/account.msg/repay':    { type: 'ghost-credit-repay',  label: 'Credit Repay' },
	'wasm-rujira-ghost-credit/account.msg/send':     { type: 'ghost-credit-send',   label: 'Credit Send' },
	'wasm-rujira-ghost-credit/account.msg/execute':  { type: 'ghost-credit-exec',   label: 'Credit Execute' },
	'wasm-rujira-ghost-credit/account.liquidate':    { type: 'ghost-liquidation',   label: 'Liquidation' },
	// CALC — DCA (Calculated Finance)
	'wasm-calc-strategy/init':            { type: 'calc-init',       label: 'DCA Create' },
	'wasm-calc-strategy/process':         { type: 'calc-process',    label: 'DCA Execute' },
	'wasm-calc-strategy/withdraw':        { type: 'calc-withdraw',   label: 'DCA Withdraw' },
	'wasm-calc-manager/strategy.create':  { type: 'calc-create',     label: 'DCA Strategy' },
	'wasm-calc-strategy/process-node.result':   { type: 'calc-internal', label: 'DCA (step)' },
	'wasm-calc-strategy/process-node.messages': { type: 'calc-internal', label: 'DCA (step)' },
	'wasm-calc-strategy/process.reply':         { type: 'calc-internal', label: 'DCA (step)' },
	'wasm-calc-strategy/execute':               { type: 'calc-process',  label: 'DCA Execute' },
	'wasm-calc-strategy/update':                { type: 'calc-update',   label: 'DCA Update' },
	'wasm-calc-manager/strategy.update':        { type: 'calc-update',   label: 'DCA Update' },
	'wasm-calc-manager/strategy.execute':       { type: 'calc-process',  label: 'DCA Execute' },
	// Auto Workflow (AutoRujira)
	'wasm-autorujira-workflow-manager/execute_instance': { type: 'auto-workflow',    label: 'Auto Workflow' },
	'wasm-autorujira-workflow-manager/cancel_instance':  { type: 'auto-cancel',      label: 'Cancel Workflow' },
	'wasm-autorujira-workflow-manager/set_user_payment_config': { type: 'auto-config', label: 'Auto Config' },
	'wasm-autorujira-fee-manager/withdraw':              { type: 'auto-fee-wd',     label: 'Auto Fee Withdraw' },
	// System / Crank
	'wasm-deferred-exec-queued':                         { type: 'deferred-exec',   label: 'Deferred Exec' },
	'wasm-crank-fee':                                    { type: 'crank-fee',       label: 'Crank Fee' },
	// Staking (RUJI/sTCY)
	'wasm-rujira-staking/liquid.bond':    { type: 'ruji-stake',      label: 'RUJI Stake' },
	'wasm-rujira-staking/liquid.unbond':  { type: 'ruji-unstake',    label: 'RUJI Unstake' },
	'wasm-rujira-staking/account.bond':   { type: 'ruji-stake',      label: 'RUJI Stake' },
	'wasm-rujira-staking/account.claim':  { type: 'ruji-claim',      label: 'RUJI Claim' },
	'wasm-rujira-staking/account.withdraw': { type: 'ruji-unstake',  label: 'RUJI Unstake' },
	// Pilot — Liquidation marketplace
	'wasm-rujira-pilot/swap':             { type: 'pilot-swap',      label: 'Liquidation Swap' },
	'wasm-rujira-pilot/order':            { type: 'pilot-order',     label: 'Liquidation Bid' },
	// Liquidy Swap (cross-chain router)
	'wasm-liquidy-swap/swap':             { type: 'liquidy-swap',    label: 'Liquidy Swap' },
	'wasm-liquidy-swap/execute':          { type: 'liquidy-exec',    label: 'Liquidy Execute' },
	'wasm-liquidy-swap-execute':          { type: 'liquidy-exec',    label: 'Liquidy Execute' },
	// BRUNE — BTC stablecoin
	'wasm-rujira-brune/swap':             { type: 'brune-swap',      label: 'BRUNE Swap' },
	'wasm-rujira-brune/mint':             { type: 'brune-mint',      label: 'BRUNE Mint' },
	'wasm-rujira-brune/burn':             { type: 'brune-burn',      label: 'BRUNE Burn' },
	'wasm-rujira-brune/node.bond':        { type: 'brune-bond',      label: 'BRUNE Bond' },
	'wasm-rujira-brune/fee.distribute':   { type: 'brune-fee',       label: 'BRUNE Fee' },
	'wasm-rujira-brune/fee.allocate':     { type: 'brune-fee',       label: 'BRUNE Fee' },
	// Nami Index
	'wasm-nami-index-fixed/deposit':      { type: 'nami-deposit',    label: 'Index Deposit' },
	'wasm-nami-index-fixed/withdraw':     { type: 'nami-withdraw',   label: 'Index Withdraw' },
	'wasm-nami-index-nav/deposit':        { type: 'nami-deposit',    label: 'Index Deposit' },
	'wasm-nami-index-nav/withdraw':       { type: 'nami-withdraw',   label: 'Index Withdraw' },
	// Revenue
	'wasm-rujira-revenue/run':            { type: 'revenue-run',     label: 'Revenue Dist' },
	// Merge
	'wasm-rujira-merge/deposit':          { type: 'merge-deposit',   label: 'Merge Deposit' },
	'wasm-rujira-merge/withdraw':         { type: 'merge-withdraw',  label: 'Merge Withdraw' },
};

// ── Dedup priority — lower = keep as primary ──

const DEDUP_PRIORITY: Record<string, number> = {
	// THORChain native user actions (highest priority)
	'swap': 1, 'addLiquidity': 2, 'withdraw': 3, 'refund': 4,
	'switch': 5, 'secure': 6, 'tcy_stake': 7, 'tcy_unstake': 8, 'donate': 9,
	// Rujira user-initiated actions
	'calc-create': 20, 'calc-update': 21, 'calc-withdraw': 22,
	'fin-order': 23, 'fin-order-wd': 24, 'fin-order-inc': 23, 'fin-order-dec': 24,
	'fin-range': 25, 'fin-range-dep': 25, 'fin-range-wd': 25,
	'fin-range-claim': 25, 'fin-range-close': 25, 'fin-range-xfer': 25,
	'ghost-lend': 26, 'ghost-withdraw': 27,
	'ghost-credit-create': 28, 'ghost-credit-action': 29,
	'ghost-credit-borrow': 28, 'ghost-credit-repay': 28,
	'ghost-credit-send': 29, 'ghost-credit-exec': 29,
	'ghost-liquidation': 28,
	'tc-swap': 30, 'bow-swap': 31, 'bow-deposit': 31, 'bow-withdraw': 31, 'fin-trade': 32,
	'auto-workflow': 40, 'auto-cancel': 40,
	'auto-config': 40, 'auto-fee-wd': 40,
	'ruji-stake': 41, 'ruji-unstake': 41, 'ruji-claim': 41,
	'pilot-swap': 42, 'pilot-order': 42,
	'liquidy-swap': 43, 'liquidy-exec': 44,
	'brune-swap': 45, 'brune-mint': 45, 'brune-burn': 45,
	'nami-deposit': 46, 'nami-withdraw': 46,
	// Generic send — only primary when no specific contract action exists
	'send': 50,
	// Internal mechanics
	'calc-process': 55, 'calc-init': 56, 'calc-internal': 57,
	'ghost-borrow': 60, 'ghost-repay': 61,
	'fin-arb': 70, 'fin-range-fee': 71, 'fin-mm-fee': 72,
	'brune-bond': 80, 'brune-fee': 82,
	'merge-deposit': 81, 'merge-withdraw': 81,
	'revenue-run': 80,
	'deferred-exec': 85, 'crank-fee': 86,
	'contract': 100, 'unknown': 999,
};

// ── Parsing helpers ──

export function parseFunds(fundsStr: string): Array<{ amount: string; asset: string }> {
	if (!fundsStr) return [];
	return fundsStr.split(',').map(part => {
		const match = part.trim().match(/^(\d+)(.+)$/);
		if (!match) return null;
		return { amount: match[1], asset: cleanAsset(match[2]) };
	}).filter(Boolean) as Array<{ amount: string; asset: string }>;
}

function parseContractAction(a: any): { type: string; assetIn: string; assetOut: string; amountIn: string; amountOut: string; rawAmountIn: string; rawAmountOut: string } | null {
	const contract = a.metadata?.contract;
	if (!contract?.contractType) return null;

	const mapped = RUJIRA_TYPE_MAP[contract.contractType];
	if (!mapped) {
		const funds = parseFunds(contract.funds || '');
		const fundAsset = funds[0]?.asset || '';
		const fundAmount = funds[0]?.amount || '0';
		return {
			type: 'contract',
			assetIn: fundAsset,
			assetOut: '',
			amountIn: formatAmount(fundAmount),
			amountOut: '',
			rawAmountIn: rawAmount(fundAmount),
			rawAmountOut: '0',
		};
	}

	const attrs = contract.attributes || {};
	const funds = parseFunds(contract.funds || '');
	const fundAsset = funds[0]?.asset || '';
	const fundAmount = funds[0]?.amount || '0';

	let assetIn = '', assetOut = '', rawIn = '0', rawOut = '0';

	switch (mapped.type) {
		case 'fin-trade': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			rawOut = attrs.bid || attrs.offer || '0';
			break;
		}
		case 'bow-swap':
		case 'tc-swap': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			if (attrs.ask) {
				const askParts = attrs.ask.match(/^(\d+)(.+)$/);
				if (askParts) { rawOut = askParts[1]; assetOut = cleanAsset(askParts[2]); }
			}
			if (attrs.returned) {
				const retParts = attrs.returned.match(/^(\d+)(.+)$/);
				if (retParts) { rawOut = retParts[1]; assetOut = cleanAsset(retParts[2]); }
			}
			break;
		}
		case 'ghost-borrow': {
			assetOut = fundAsset;
			rawOut = attrs.amount || fundAmount;
			break;
		}
		case 'ghost-repay': {
			assetIn = fundAsset;
			rawIn = attrs.amount || fundAmount;
			break;
		}
		case 'ghost-lend': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			break;
		}
		case 'ghost-withdraw': {
			assetOut = fundAsset;
			rawOut = attrs.amount || fundAmount;
			break;
		}
		case 'fin-range': {
			if (funds.length >= 2) {
				assetIn = funds[0].asset;
				rawIn = funds[0].amount;
				assetOut = funds[1].asset;
				rawOut = funds[1].amount;
			} else if (funds.length === 1) {
				assetIn = fundAsset;
				rawIn = fundAmount;
			}
			break;
		}
		case 'fin-range-fee': {
			if (attrs.base && attrs.base !== '0') { rawOut = attrs.base; }
			if (attrs.quote && attrs.quote !== '0') { rawOut = attrs.quote; }
			break;
		}
		case 'fin-order': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			break;
		}
		case 'fin-order-wd': {
			assetOut = fundAsset;
			rawOut = attrs.amount || fundAmount;
			break;
		}
		case 'fin-order-inc':
		case 'fin-order-dec': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			break;
		}
		case 'fin-range-dep': {
			if (funds.length >= 2) {
				assetIn = funds[0].asset; rawIn = funds[0].amount;
				assetOut = funds[1].asset; rawOut = funds[1].amount;
			} else if (funds.length === 1) {
				assetIn = fundAsset; rawIn = fundAmount;
			}
			break;
		}
		case 'fin-range-wd':
		case 'fin-range-close': {
			assetOut = fundAsset;
			rawOut = fundAmount;
			if (attrs.amount) rawOut = attrs.amount;
			break;
		}
		case 'fin-range-claim': {
			if (attrs.base && attrs.base !== '0') { rawOut = attrs.base; }
			if (attrs.quote && attrs.quote !== '0') { rawOut = attrs.quote; }
			break;
		}
		case 'fin-range-xfer': {
			break;
		}
		case 'fin-mm-fee': {
			if (attrs.base && attrs.base !== '0') { rawOut = attrs.base; }
			if (attrs.quote && attrs.quote !== '0') { rawOut = attrs.quote; }
			break;
		}
		case 'ghost-credit-create': {
			break;
		}
		case 'ghost-credit-borrow': {
			assetOut = fundAsset;
			rawOut = attrs.amount || fundAmount;
			break;
		}
		case 'ghost-credit-repay': {
			assetIn = fundAsset;
			rawIn = attrs.amount || fundAmount;
			break;
		}
		case 'ghost-credit-send':
		case 'ghost-credit-exec':
		case 'ghost-credit-action': {
			if (fundAmount !== '0') { assetIn = fundAsset; rawIn = fundAmount; }
			break;
		}
		case 'ghost-liquidation': {
			if (fundAmount !== '0') { assetIn = fundAsset; rawIn = fundAmount; }
			break;
		}
		case 'bow-deposit': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			break;
		}
		case 'bow-withdraw': {
			assetOut = fundAsset;
			rawOut = fundAmount;
			break;
		}
		case 'ruji-stake': {
			assetIn = fundAsset || 'RUJI';
			rawIn = fundAmount;
			break;
		}
		case 'ruji-unstake':
		case 'ruji-claim': {
			assetOut = 'RUJI';
			rawOut = attrs.returned || fundAmount;
			break;
		}
		case 'pilot-swap': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			if (attrs.returned) {
				const retParts = attrs.returned.match(/^(\d+)(.+)$/);
				if (retParts) { rawOut = retParts[1]; assetOut = cleanAsset(retParts[2]); }
			}
			break;
		}
		case 'pilot-order': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			break;
		}
		case 'liquidy-swap':
		case 'liquidy-exec': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			if (attrs.returned) {
				const retParts = attrs.returned.match(/^(\d+)(.+)$/);
				if (retParts) { rawOut = retParts[1]; assetOut = cleanAsset(retParts[2]); }
			}
			break;
		}
		case 'brune-swap': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			if (attrs.returned) {
				const retParts = attrs.returned.match(/^(\d+)(.+)$/);
				if (retParts) { rawOut = retParts[1]; assetOut = cleanAsset(retParts[2]); }
			}
			break;
		}
		case 'brune-mint': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			assetOut = 'BRUNE';
			rawOut = attrs.amount || fundAmount;
			break;
		}
		case 'brune-burn': {
			assetIn = 'BRUNE';
			rawIn = fundAmount;
			break;
		}
		case 'brune-bond':
		case 'brune-fee': {
			if (fundAmount !== '0') { assetIn = fundAsset; rawIn = fundAmount; }
			break;
		}
		case 'nami-deposit': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			break;
		}
		case 'nami-withdraw': {
			assetOut = fundAsset;
			rawOut = fundAmount;
			break;
		}
		case 'auto-workflow':
		case 'auto-cancel':
		case 'auto-config':
		case 'auto-fee-wd':
		case 'deferred-exec':
		case 'crank-fee':
		case 'revenue-run':
		case 'merge-deposit':
		case 'merge-withdraw': {
			if (fundAmount !== '0') { assetIn = fundAsset; rawIn = fundAmount; }
			break;
		}
		default: {
			if (fundAmount !== '0') {
				assetIn = fundAsset;
				rawIn = fundAmount;
			}
			break;
		}
	}

	return {
		type: mapped.type,
		assetIn,
		assetOut,
		amountIn: formatAmount(rawIn),
		amountOut: formatAmount(rawOut),
		rawAmountIn: rawAmount(rawIn),
		rawAmountOut: rawAmount(rawOut),
	};
}

function extractFees(a: any): { feeAmount: string; feeCurrency: string } {
	const meta = a.metadata || {};
	const swapMeta = meta.swap || meta.addLiquidity || meta.withdraw || {};
	const networkFees = swapMeta.networkFees || a.metadata?.withdraw?.networkFees || [];
	if (networkFees.length > 0) {
		const fee = networkFees[0];
		return {
			feeAmount: rawAmount(fee.amount || '0'),
			feeCurrency: cleanAsset(fee.asset || ''),
		};
	}
	if (swapMeta.liquidityFee && swapMeta.liquidityFee !== '0') {
		return {
			feeAmount: rawAmount(swapMeta.liquidityFee),
			feeCurrency: 'RUNE',
		};
	}
	return { feeAmount: '', feeCurrency: '' };
}

export function parseAction(a: any): HistoryTransaction {
	const ins = a.in || [];
	const outs = a.out || [];
	const coinsIn = ins[0]?.coins?.[0] || {};
	const coinsOut = outs[0]?.coins?.[0] || {};
	const fees = extractFees(a);

	const from = ins[0]?.address || '';
	const to = outs[0]?.address || '';
	const fromLabel = getContractLabel(from) || '';
	const toLabel = getContractLabel(to) || '';

	// Enrich with contract metadata
	const fromContract = getContract(from);
	const toContract = getContract(to);
	const contractName = fromContract?.name || toContract?.name || '';
	const contractCategory = fromContract?.category || toContract?.category || '';

	if (a.type === 'contract') {
		const decoded = parseContractAction(a);
		if (decoded) {
			return {
				type: decoded.type,
				date: a.date ? new Date(parseInt(a.date) / 1e6).toISOString() : '',
				assetIn: decoded.assetIn,
				assetOut: decoded.assetOut,
				amountIn: decoded.amountIn,
				amountOut: decoded.amountOut,
				rawAmountIn: decoded.rawAmountIn,
				rawAmountOut: decoded.rawAmountOut,
				from,
				to,
				fromLabel,
				toLabel,
				txID: ins[0]?.txID || '',
				status: a.status || 'unknown',
				feeAmount: fees.feeAmount,
				feeCurrency: fees.feeCurrency,
				contractName,
				contractCategory,
			};
		}
	}

	return {
		type: a.type || 'unknown',
		date: a.date ? new Date(parseInt(a.date) / 1e6).toISOString() : '',
		assetIn: cleanAsset(coinsIn.asset || ''),
		assetOut: cleanAsset(coinsOut.asset || ''),
		amountIn: formatAmount(coinsIn.amount || '0'),
		amountOut: formatAmount(coinsOut.amount || '0'),
		rawAmountIn: rawAmount(coinsIn.amount || '0'),
		rawAmountOut: rawAmount(coinsOut.amount || '0'),
		from,
		to,
		fromLabel,
		toLabel,
		txID: ins[0]?.txID || '',
		status: a.status || 'unknown',
		feeAmount: fees.feeAmount,
		feeCurrency: fees.feeCurrency,
		contractName,
		contractCategory,
	};
}

// ── Data fetching ──

export async function fetchMidgardActions(address: string): Promise<HistoryTransaction[]> {
	let all: HistoryTransaction[] = [];
	const pageSize = 50;
	const maxPages = 100;
	let nextPageToken: string | null = null;

	for (let page = 0; page < maxPages; page++) {
		try {
			let url = `${MIDGARD_URL}/v2/actions?address=${address}&limit=${pageSize}`;
			if (nextPageToken) {
				url += `&nextPageToken=${nextPageToken}`;
			} else if (page > 0) {
				break;
			}

			const res = await fetch(url);
			if (!res.ok) break;
			const data: any = await res.json();
			const actions = data?.actions || [];
			if (actions.length === 0) break;

			all.push(...actions.map(parseAction).filter(Boolean));

			nextPageToken = data?.meta?.nextPageToken || null;
			if (!nextPageToken || actions.length < pageSize) break;

			await new Promise(r => setTimeout(r, 150));
		} catch { break; }
	}

	// 2-pass: resolve fin-trade output assets from sibling tc-swap/bow-swap
	const byTxID = new Map<string, HistoryTransaction[]>();
	for (const tx of all) {
		if (tx.txID) {
			if (!byTxID.has(tx.txID)) byTxID.set(tx.txID, []);
			byTxID.get(tx.txID)!.push(tx);
		}
	}
	for (const [, group] of byTxID) {
		let resolvedOutAsset = '';
		for (const tx of group) {
			if ((tx.type === 'tc-swap' || tx.type === 'bow-swap') && tx.assetOut) {
				resolvedOutAsset = tx.assetOut;
				break;
			}
		}
		if (resolvedOutAsset) {
			for (const tx of group) {
				if (tx.type === 'fin-trade' && !tx.assetOut) {
					tx.assetOut = resolvedOutAsset;
				}
			}
		}
	}

	return all;
}

export async function fetchBalances(address: string): Promise<Array<{ asset: string; amount: string }>> {
	try {
		const res = await fetch(`${THORNODE_URL}/cosmos/bank/v1beta1/balances/${address}`);
		if (!res.ok) return [];
		const data = await res.json();
		const balances = data?.balances || [];

		const merged = new Map<string, number>();
		for (const b of balances) {
			const denom = b.denom || '';
			// Skip share/receipt tokens (LP positions, staking receipts, vault shares)
			if (/^x\/(bow-|ghost-|staking-|nami-index-|fin-)/.test(denom)) continue;
			const asset = denom === 'rune' ? 'RUNE' : cleanAsset(denom);
			if (!asset) continue;
			const raw = parseInt(b.amount || '0');
			if (raw === 0) continue;
			merged.set(asset, (merged.get(asset) || 0) + raw);
		}

		return [...merged.entries()]
			.sort(([, a], [, b]) => b - a)
			.map(([asset, total]) => ({
				asset,
				amount: formatAmount(String(total)),
			}))
			.filter(b => b.amount !== '0');
	} catch {
		return [];
	}
}

// ── Transaction grouping ──

export function groupTransactions(txs: HistoryTransaction[], userAddress?: string): HistoryGroup[] {
	const groups: HistoryGroup[] = [];
	const idxMap = new Map<string, number>();

	for (const tx of txs) {
		if (!tx.txID) {
			groups.push({ primary: tx, subActions: [], internalCount: 0, txID: '' });
			continue;
		}

		const idx = idxMap.get(tx.txID);
		if (idx !== undefined) {
			const g = groups[idx];
			const newPri = getPriority(tx, userAddress);
			const curPri = getPriority(g.primary, userAddress);
			if (newPri < curPri) {
				g.subActions.push(g.primary);
				g.primary = tx;
			} else {
				g.subActions.push(tx);
			}
		} else {
			idxMap.set(tx.txID, groups.length);
			groups.push({ primary: tx, subActions: [], internalCount: 0, txID: tx.txID });
		}
	}

	// Enrich primary + split subActions into visible vs internal
	for (const g of groups) {
		// Enrich primary's missing output asset from trade/swap siblings
		if (!g.primary.assetOut || g.primary.amountOut === '0') {
			for (const s of g.subActions) {
				if (s.assetOut && s.amountOut !== '0' &&
					['swap', 'fin-trade', 'tc-swap', 'bow-swap', 'fin-order-wd'].includes(s.type)) {
					g.primary.assetOut = s.assetOut;
					g.primary.amountOut = s.amountOut;
					g.primary.rawAmountOut = s.rawAmountOut;
					break;
				}
			}
		}
		// Enrich primary's missing input asset from trade/swap siblings
		if (!g.primary.assetIn || g.primary.amountIn === '0') {
			for (const s of g.subActions) {
				if (s.assetIn && s.amountIn !== '0' &&
					['swap', 'fin-trade', 'tc-swap', 'bow-swap'].includes(s.type)) {
					g.primary.assetIn = s.assetIn;
					g.primary.amountIn = s.amountIn;
					g.primary.rawAmountIn = s.rawAmountIn;
					break;
				}
			}
		}

		// Split into visible vs internal
		const visible: HistoryTransaction[] = [];
		let internalCount = 0;
		for (const s of g.subActions) {
			if (INTERNAL_TYPES.has(s.type)) {
				internalCount++;
			} else {
				visible.push(s);
			}
		}

		// Cap visible sub-actions at 5 to avoid UI clutter
		if (visible.length > 5) {
			internalCount += visible.length - 5;
			visible.length = 5;
		}

		g.subActions = visible;
		g.internalCount = internalCount;
	}

	return groups;
}

/**
 * Tiered priority for picking the primary action from a txID group.
 * Lower number = higher priority (shown as primary).
 *
 * Tier 1 (0-99): User is the initiator (from === userAddress) — pick by DEDUP_PRIORITY
 * Tier 2 (100-199): User is the recipient (to === userAddress) — pick by DEDUP_PRIORITY
 * Tier 3 (200-299): THORChain native types
 * Tier 4 (300+): Internal mechanics / unknown
 */
function getPriority(tx: HistoryTransaction, userAddress?: string): number {
	const base = DEDUP_PRIORITY[tx.type] ?? 500;

	if (!userAddress) return base;

	const fromIsUser = tx.from === userAddress;
	const toIsUser = tx.to === userAddress;
	const fromIsContract = isContract(tx.from);
	const toIsContract = isContract(tx.to);

	// Internal contract-to-contract: deprioritize heavily
	if (fromIsContract && toIsContract && !fromIsUser && !toIsUser) {
		return 300 + base;
	}

	// User initiated this action
	if (fromIsUser) {
		return base; // Tier 1: use raw priority
	}

	// User received from this action
	if (toIsUser) {
		return 100 + base; // Tier 2: slight deprioritization
	}

	// Neither user nor contract-to-contract: THORChain native
	return 200 + base;
}
