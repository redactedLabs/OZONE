/**
 * Engine-wide policy constants (kept in one place so the tracer, the
 * snapshot builder and the methodology page agree).
 */

/**
 * Listings whose same-key twins are published and traced: an identified
 * holder (a sanctioned or law-enforcement-attributed party, an issuer
 * freeze, a maintainer flag). Not hack clusters, exploiter or phishing
 * labels: their addresses are mostly single-use, so a twin adds snapshot
 * weight, not signal.
 */
export const TWIN_CATEGORIES: ReadonlySet<string> = new Set(['sanctions', 'law_enforcement', 'stablecoin_freeze', 'manual']);
