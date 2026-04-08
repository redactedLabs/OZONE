// Shared display constants for transaction history — used by both history and report pages

export interface HistoryTransaction {
	type: string;
	date: string;
	assetIn: string;
	assetOut: string;
	amountIn: string;
	amountOut: string;
	rawAmountIn: string;
	rawAmountOut: string;
	from: string;
	to: string;
	fromLabel: string;
	toLabel: string;
	txID: string;
	status: string;
	feeAmount?: string;
	feeCurrency?: string;
	contractName?: string;
	contractCategory?: string;
}

export interface HistoryGroup {
	primary: HistoryTransaction;
	subActions: HistoryTransaction[];
	internalCount: number;
	txID: string;
}

export interface HistoryResponse {
	reportId: string;
	totalTransactions: number;
	transactions: HistoryTransaction[];
	groups: HistoryGroup[];
	balances: Array<{ asset: string; amount: string }>;
	dateFrom: string | null;
	dateTo: string | null;
	includeNew: boolean;
	revealWallet: boolean;
	address: string | null;
	generated: string | null;
	shareUrl?: string;
}

export const TYPE_LABELS: Record<string, string> = {
	swap: 'Swap', addLiquidity: 'Add LP', withdraw: 'Withdraw', send: 'Send', refund: 'Refund',
	switch: 'Switch', contract: 'Contract', donate: 'Donate',
	// FIN — Orderbook
	'fin-trade': 'Trade', 'fin-arb': 'Arb',
	'fin-order': 'Limit Order', 'fin-order-wd': 'Claim Order',
	'fin-order-inc': 'Increase Order', 'fin-order-dec': 'Cancel Order',
	'fin-mm-fee': 'MM Fee',
	// FIN Range — Concentrated Liquidity
	'fin-range': 'Range Create', 'fin-range-dep': 'Range Deposit',
	'fin-range-wd': 'Range Withdraw', 'fin-range-claim': 'Range Claim',
	'fin-range-close': 'Range Close', 'fin-range-xfer': 'Range Transfer',
	'fin-range-fee': 'Range Fee',
	// BOW — AMM
	'bow-swap': 'AMM Swap', 'bow-deposit': 'AMM Deposit', 'bow-withdraw': 'AMM Withdraw',
	// TC Swap
	'tc-swap': 'Market Order',
	// Ghost Vault — Lending
	'ghost-borrow': 'Borrow', 'ghost-repay': 'Repay',
	'ghost-lend': 'Lend', 'ghost-withdraw': 'Withdraw Lend',
	// Ghost Credit — Credit Accounts
	'ghost-credit-create': 'Credit Account', 'ghost-credit-action': 'Credit Action',
	'ghost-credit-borrow': 'Credit Borrow', 'ghost-credit-repay': 'Credit Repay',
	'ghost-credit-send': 'Credit Send', 'ghost-credit-exec': 'Credit Execute',
	'ghost-liquidation': 'Liquidation',
	// CALC — DCA
	'calc-init': 'DCA Create', 'calc-process': 'DCA Execute',
	'calc-withdraw': 'DCA Withdraw', 'calc-create': 'DCA Strategy',
	'calc-internal': 'DCA (step)', 'calc-update': 'DCA Update',
	// AutoRujira
	'auto-workflow': 'Auto Workflow', 'auto-cancel': 'Cancel Workflow',
	'auto-config': 'Auto Config', 'auto-fee-wd': 'Auto Fee WD',
	// System
	'deferred-exec': 'Deferred Exec', 'crank-fee': 'Crank Fee',
	// Staking
	'ruji-stake': 'RUJI Stake', 'ruji-unstake': 'RUJI Unstake', 'ruji-claim': 'RUJI Claim',
	// Pilot — Liquidations
	'pilot-swap': 'Liquidation Swap', 'pilot-order': 'Liquidation Bid',
	// Liquidy
	'liquidy-swap': 'Liquidy Swap', 'liquidy-exec': 'Liquidy Execute',
	// BRUNE
	'brune-swap': 'BRUNE Swap', 'brune-mint': 'BRUNE Mint', 'brune-burn': 'BRUNE Burn',
	'brune-bond': 'BRUNE Bond', 'brune-fee': 'BRUNE Fee',
	// Nami Index
	'nami-deposit': 'Index Deposit', 'nami-withdraw': 'Index Withdraw',
	// Other
	'revenue-run': 'Revenue Dist', 'merge-deposit': 'Merge', 'merge-withdraw': 'Merge Out',
	'secure': 'Secure', 'tcy_stake': 'TCY Stake', 'tcy_unstake': 'TCY Unstake',
};

export const TYPE_COLORS: Record<string, string> = {
	swap: 'var(--app-accent)', addLiquidity: '#10b981', withdraw: '#f59e0b', send: '#22d3ee', refund: '#ef4444',
	switch: '#a78bfa', contract: '#64748b', donate: '#f472b6',
	'fin-trade': '#f59e0b', 'fin-arb': '#f97316',
	'fin-order': '#f59e0b', 'fin-order-wd': '#f59e0b',
	'fin-order-inc': '#f59e0b', 'fin-order-dec': '#f59e0b',
	'fin-mm-fee': '#f97316',
	'fin-range': '#10b981', 'fin-range-dep': '#10b981',
	'fin-range-wd': '#10b981', 'fin-range-claim': '#10b981',
	'fin-range-close': '#10b981', 'fin-range-xfer': '#10b981',
	'fin-range-fee': '#10b981',
	'bow-swap': '#6366f1', 'bow-deposit': '#6366f1', 'bow-withdraw': '#6366f1',
	'tc-swap': '#6366f1',
	'ghost-borrow': '#ef4444', 'ghost-repay': '#22c55e',
	'ghost-lend': '#6366f1', 'ghost-withdraw': '#a78bfa',
	'ghost-credit-create': '#8b5cf6', 'ghost-credit-action': '#8b5cf6',
	'ghost-credit-borrow': '#ef4444', 'ghost-credit-repay': '#22c55e',
	'ghost-credit-send': '#8b5cf6', 'ghost-credit-exec': '#8b5cf6',
	'ghost-liquidation': '#ef4444',
	'calc-init': '#a78bfa', 'calc-process': '#a78bfa',
	'calc-withdraw': '#a78bfa', 'calc-create': '#a78bfa',
	'calc-internal': '#94a3b8', 'calc-update': '#94a3b8',
	'auto-workflow': '#94a3b8', 'auto-cancel': '#94a3b8',
	'auto-config': '#94a3b8', 'auto-fee-wd': '#94a3b8',
	'deferred-exec': '#64748b', 'crank-fee': '#64748b',
	'ruji-stake': '#10b981', 'ruji-unstake': '#f59e0b', 'ruji-claim': '#10b981',
	'pilot-swap': '#ef4444', 'pilot-order': '#ef4444',
	'liquidy-swap': '#22d3ee', 'liquidy-exec': '#22d3ee',
	'brune-swap': '#f97316', 'brune-mint': '#f97316', 'brune-burn': '#f97316',
	'brune-bond': '#f97316', 'brune-fee': '#94a3b8',
	'nami-deposit': '#3b82f6', 'nami-withdraw': '#3b82f6',
	'revenue-run': '#94a3b8', 'merge-deposit': '#94a3b8', 'merge-withdraw': '#94a3b8',
	'secure': '#3b82f6', 'tcy_stake': '#10b981', 'tcy_unstake': '#f59e0b',
};

/** Types that are internal contract mechanics — hidden as siblings, shown as count */
export const INTERNAL_TYPES = new Set([
	'fin-trade', 'fin-arb', 'fin-range-fee', 'fin-mm-fee',
	'ghost-borrow', 'ghost-repay',
	'crank-fee', 'deferred-exec', 'revenue-run', 'contract',
]);

/** Map transaction type to Koinly label */
export function getKoinlyLabel(type: string): string {
	if (['swap', 'fin-trade', 'fin-arb', 'bow-swap', 'tc-swap', 'calc-process',
		'liquidy-swap', 'liquidy-exec', 'brune-swap', 'pilot-swap'].includes(type)) return '';
	if (['addLiquidity', 'fin-range', 'fin-range-dep', 'bow-deposit', 'nami-deposit'].includes(type)) return 'liquidity_in';
	if (['withdraw', 'fin-range-wd', 'fin-range-close', 'bow-withdraw', 'nami-withdraw'].includes(type)) return 'liquidity_out';
	if (['ghost-borrow', 'ghost-credit-borrow'].includes(type)) return 'borrow';
	if (['ghost-repay', 'ghost-credit-repay'].includes(type)) return 'repay';
	if (['ghost-lend', 'ghost-credit-create'].includes(type)) return 'deposit';
	if (['ghost-withdraw', 'ghost-credit-send'].includes(type)) return 'withdrawal';
	if (['fin-range-fee', 'fin-range-claim', 'fin-mm-fee', 'ruji-claim'].includes(type)) return 'income';
	if (['ruji-stake'].includes(type)) return 'staking';
	if (['ruji-unstake'].includes(type)) return 'unstaking';
	return '';
}
