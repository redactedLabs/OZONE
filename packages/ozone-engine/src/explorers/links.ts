/**
 * Human links to a transaction on a public explorer (provenance on reasons;
 * never fetched by Ozone).
 */
const TX_URL: Record<string, (h: string) => string> = {
	ETH: (h) => `https://etherscan.io/tx/${h}`,
	ARB: (h) => `https://arbiscan.io/tx/${h}`,
	OP: (h) => `https://optimistic.etherscan.io/tx/${h}`,
	BASE: (h) => `https://basescan.org/tx/${h}`,
	POL: (h) => `https://polygonscan.com/tx/${h}`,
	AVAX: (h) => `https://snowtrace.io/tx/${h}`,
	BSC: (h) => `https://bscscan.com/tx/${h}`,
	GNOSIS: (h) => `https://gnosisscan.io/tx/${h}`,
	BTC: (h) => `https://mempool.space/tx/${h}`,
	LTC: (h) => `https://litecoinspace.org/tx/${h}`
};

/** The explorer page of an L1 transaction on `chain`, if Ozone knows one. */
export function l1TxUrl(chain: string, txid: string): string | undefined {
	return TX_URL[chain.toUpperCase()]?.(txid);
}

/** The page of a THORChain transaction. */
export function thorchainTxUrl(txid: string): string {
	return `https://runescan.io/tx/${txid}`;
}
