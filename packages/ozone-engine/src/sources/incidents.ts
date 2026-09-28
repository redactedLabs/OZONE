/**
 * The curated incident dataset as list entries: validation (checksums,
 * sources, roles, confidence) and conversion, one entry per address.
 *
 * - risk: `severe` for high confidence (law enforcement, sanctions, the
 *   victim itself), `high` for medium (an established investigator);
 * - every reason names its incident (the entity is the incident name, so
 *   traced reasons downstream name it too);
 * - an address named by several incidents is one entry that names them all,
 *   with the strongest confidence;
 * - `delisted` addresses stay as history (removedAt), and an incident that
 *   is removed from the dataset delists its addresses at the next sync.
 */
import { parseForChain, riskRank, type Risk } from '../../../ozone-client/src/index.js';
import { emptyResult, type ListEntry, type ParseResult } from '../types.js';
import { toChecksumAddress } from '../util/evm.js';
import { CURATED, type Confidence, type CuratedData, type CuratedIncident, type IncidentAddress, type IncidentRole, type RefType } from './curated-data.js';

export const CONFIDENCE_RISK: Record<Confidence, Risk> = { high: 'severe', medium: 'high' };

const ROLE_TEXT: Record<IncidentRole, string> = {
	exploiter: 'attacker address that received the stolen funds',
	laundering: 'address the stolen funds were moved to',
	cashout: 'attacker cash-out address'
};

const REF_TEXT: Record<RefType, string> = {
	law_enforcement: 'law enforcement',
	sanctions: 'a sanctions designation',
	victim: 'the victim',
	investigator: 'an established investigator'
};

const ROLES: readonly IncidentRole[] = ['exploiter', 'laundering', 'cashout'];
const REF_TYPES: readonly RefType[] = ['law_enforcement', 'sanctions', 'victim', 'investigator'];
const CONFIDENCES: readonly Confidence[] = ['high', 'medium'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Reason code of an address (the incident's own code, or one per role). */
export function incidentCode(inc: CuratedIncident, a: IncidentAddress): string {
	return inc.code ?? `INCIDENT_${a.role.toUpperCase()}`;
}

/** Categories whose attributions are about one theft (their earlier activity is not its proceeds). */
const DATED_CATEGORIES = new Set(['hack', 'exploit']);

/** Problems in the dataset (empty when it is sound). */
export function validateIncidents(data: CuratedData = CURATED): string[] {
	const problems: string[] = [];
	const ids = new Set<string>();
	for (const inc of data.incidents) {
		const where = `incident ${inc.id}`;
		if (!/^[a-z0-9][a-z0-9-]*$/.test(inc.id)) problems.push(`${where}: id must be kebab-case`);
		if (ids.has(inc.id)) problems.push(`${where}: duplicate id`);
		ids.add(inc.id);
		if (!DATE.test(inc.date) || Number.isNaN(Date.parse(inc.date))) problems.push(`${where}: bad date ${inc.date}`);
		if (!/^https:\/\//.test(inc.ref)) problems.push(`${where}: ref must be an https URL`);
		if (!['yes', 'no', 'unknown'].includes(inc.thorchain?.used)) problems.push(`${where}: thorchain.used must be yes, no or unknown`);
		if (inc.thorchain?.used === 'yes' && !/^https:\/\//.test(inc.thorchain.ref ?? '')) problems.push(`${where}: THORChain use needs a source`);
		if (inc.window && !(Date.parse(inc.window.from) < Date.parse(inc.window.to))) problems.push(`${where}: window must run forward`);
		if (!inc.addresses.length) problems.push(`${where}: no addresses (list it under searched instead)`);
		const keys = new Set<string>();
		for (const a of inc.addresses) {
			const at = `${where} ${a.chain}:${a.address}`;
			const p = parseForChain(a.address, a.chain);
			if (!p) {
				problems.push(`${at}: not a valid ${a.chain} address`);
				continue;
			}
			if (p.namespace === 'evm' && /[A-F]/.test(a.address.slice(2)) && /[a-f]/.test(a.address.slice(2)) && toChecksumAddress(a.address) !== a.address) {
				problems.push(`${at}: EIP-55 checksum mismatch`);
			}
			if (keys.has(p.key)) problems.push(`${at}: listed twice in the incident`);
			keys.add(p.key);
			if (!ROLES.includes(a.role)) problems.push(`${at}: bad role ${a.role}`);
			if (!REF_TYPES.includes(a.refType)) problems.push(`${at}: bad refType ${a.refType}`);
			if (!CONFIDENCES.includes(a.confidence)) problems.push(`${at}: bad confidence ${a.confidence}`);
			if (!/^https:\/\//.test(a.ref)) problems.push(`${at}: ref must be an https URL`);
			if (a.confidence === 'high' && a.refType === 'investigator') problems.push(`${at}: an investigator source is medium confidence`);
			if (a.delisted && (!DATE.test(a.delisted.date) || !a.delisted.reason)) problems.push(`${at}: delisted needs a date and a reason`);
		}
	}
	for (const s of data.searched) if (!s.name || !s.why) problems.push(`searched ${s.name || '?'}: needs a name and a reason`);
	return problems;
}

interface Named {
	inc: CuratedIncident;
	a: IncidentAddress;
	p: NonNullable<ReturnType<typeof parseForChain>>;
}

function entryFor(first: Named, others: Named[]): ListEntry {
	const { inc, a, p } = first;
	const risk = CONFIDENCE_RISK[a.confidence];
	const also = others.filter((o) => o.inc.id !== inc.id);
	const alsoText = also.length ? ` Also named in: ${[...new Set(also.map((o) => o.inc.name))].join('; ')}.` : '';
	const since = DATED_CATEGORIES.has(inc.category) ? new Date(Date.parse(inc.date) - 24 * 3600_000).toISOString() : undefined;
	const removed = a.delisted && others.every((o) => o.a.delisted);
	return {
		source: 'curated',
		key: p.key,
		chain: p.chain,
		address: p.address,
		category: inc.category,
		risk,
		code: incidentCode(inc, a),
		entity: inc.name,
		text: `${inc.name}: ${ROLE_TEXT[a.role]}, named by ${REF_TEXT[a.refType]}${a.note ? ` (${a.note})` : ''}. Attribution: ${inc.attribution}.${alsoText}`,
		refUrl: a.ref,
		refId: inc.id,
		listedAt: inc.date,
		...(removed ? { removedAt: a.delisted!.date } : {}),
		meta: {
			incident: inc.id,
			incidentName: inc.name,
			role: a.role,
			confidence: a.confidence,
			refType: a.refType,
			verification: inc.verification,
			incidentRef: inc.ref,
			thorchain: inc.thorchain.used,
			...(also.length ? { alsoIncidents: [...new Set(also.map((o) => o.inc.id))] } : {}),
			...(since ? { since } : {}),
			...(removed ? { removedReason: a.delisted!.reason } : {})
		}
	};
}

/**
 * The dataset as `curated` source entries. Throws on the first invalid
 * address or missing source, so a bad edit fails the sync instead of
 * publishing a wrong listing.
 */
export function parseCurated(data: CuratedData = CURATED): ParseResult {
	const problems = validateIncidents(data);
	if (problems.length) throw new Error(`curated incidents: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ` (+${problems.length - 5} more)` : ''}`);
	const byKey = new Map<string, Named[]>();
	for (const inc of data.incidents) {
		for (const a of inc.addresses) {
			const p = parseForChain(a.address, a.chain)!;
			const list = byKey.get(p.key) ?? [];
			list.push({ inc, a, p });
			byKey.set(p.key, list);
		}
	}
	const res = emptyResult();
	res.version = `${data.version}:${data.incidents.length} incidents`;
	for (const named of byKey.values()) {
		// the strongest active naming leads (then the earliest incident)
		const ordered = [...named].sort(
			(x, y) =>
				Number(!!x.a.delisted) - Number(!!y.a.delisted) ||
				riskRank(CONFIDENCE_RISK[y.a.confidence]) - riskRank(CONFIDENCE_RISK[x.a.confidence]) ||
				x.inc.date.localeCompare(y.inc.date)
		);
		res.entries.push(entryFor(ordered[0], ordered.slice(1)));
	}
	return res;
}

/** Incidents per THORChain use and totals (methodology page, reports). */
export function incidentStats(data: CuratedData = CURATED) {
	const active = (inc: CuratedIncident) => inc.addresses.filter((a) => !a.delisted);
	return {
		incidents: data.incidents.length,
		addresses: data.incidents.reduce((n, i) => n + active(i).length, 0),
		thorchain: data.incidents.filter((i) => i.thorchain.used === 'yes').length,
		searched: data.searched.length
	};
}
