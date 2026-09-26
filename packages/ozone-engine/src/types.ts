import type { Category, Risk } from '../../ozone-client/src/index.js';

/** One address as published by one source (after validation/normalization). */
export interface ListEntry {
	/** Source id (see sources/registry.ts). */
	source: string;
	/** Canonical key `<namespace>:<address>`. */
	key: string;
	/** Chain code the address belongs to (ETH, BTC, TRON, …). */
	chain: string;
	/** Canonical display form. */
	address: string;
	category: Category;
	risk: Risk;
	/** Reason code, e.g. OFAC_SDN. */
	code: string;
	entity?: string;
	/** Human-readable reason. */
	text: string;
	/** Provenance URL. */
	refUrl?: string;
	/** Source-specific id (list uid, event tx hash, …). */
	refId?: string;
	/** When the source listed it (ISO), if known. */
	listedAt?: string;
	/** When the source removed it (event-sourced lists only). */
	removedAt?: string;
	meta?: Record<string, unknown>;
}

export interface ParseResult {
	entries: ListEntry[];
	/** Source-side version (publish date, record count, commit, …). */
	version?: string;
	/** Addresses that did not validate (reported, never imported). */
	rejected: Array<{ raw: string; declared?: string; context?: string }>;
	/** Free-form notes (e.g. declared-chain mismatches). */
	notes: string[];
}

export function emptyResult(): ParseResult {
	return { entries: [], rejected: [], notes: [] };
}

/** Minimal SQL client (pg Pool, pg Client and PGlite all satisfy it). */
export interface Sql {
	query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Logger {
	info(msg: string, data?: unknown): void;
	warn(msg: string, data?: unknown): void;
	error(msg: string, data?: unknown): void;
}

export const consoleLogger: Logger = {
	info: (m, d) => console.log(`[ozone] ${m}`, d ?? ''),
	warn: (m, d) => console.warn(`[ozone] ${m}`, d ?? ''),
	error: (m, d) => console.error(`[ozone] ${m}`, d ?? '')
};

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
