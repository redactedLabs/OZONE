/**
 * Flags THORChain accounts ("users" discovered by the app/worker) from the
 * snapshot's verdicts:
 *
 * - **direct**: the account itself is listed or traced;
 * - **linked**: an L1 address linked to the account (Midgard history) is
 *   listed — one risk level lower, because a link can be a counterparty.
 *
 * Links tagged `affiliate` are ignored, and so are hub accounts (module
 * accounts, affiliate fee collectors, accounts linked to more than
 * `hubLinks` addresses): before this rule the two only accounts the old
 * screener flagged were exactly such hubs — THORChain's affiliate_collector
 * module and an interface's affiliate address, linked to 32,047 and 3,610
 * unrelated swappers' addresses.
 */
import {
	addressReadings,
	isActive,
	riskFromRank,
	riskRank,
	type Reason,
	type Risk,
	type SnapshotIndex
} from '../../../ozone-client/src/index.js';
import { THORCHAIN_MODULES } from '../trace/flows.js';
import type { Sql } from '../types.js';
import { batchInsert, withTransaction } from '../store/db.js';

export interface UserScreenOptions {
	flagAt?: Risk;
	hubLinks?: number;
}

export interface UserScreenResult {
	accounts: number;
	thorAccounts: number;
	linkedAddresses: number;
	flagged: number;
	flaggedDirect: number;
	flaggedLinked: number;
	hubsSkipped: number;
}

interface UserVerdict {
	thor: string;
	risk: Risk;
	flagged: boolean;
	reasons: Array<{ via: string; code: string; source: string; risk: Risk; text: string }>;
}

export async function screenUsers(sql: Sql, snap: SnapshotIndex, opts: UserScreenOptions = {}): Promise<UserScreenResult> {
	const flagAt = riskRank(opts.flagAt ?? 'high');
	const hubLinks = opts.hubLinks ?? 500;
	const users = (await sql.query<{ thor_address: string }>(`SELECT thor_address FROM rujira_users`)).rows.map((r) => r.thor_address);
	const links = new Map<string, string[]>();
	let linkedAddresses = 0;
	for (const r of (
		await sql.query<{ thor_address: string; l1_address: string; chain: string }>(
			`SELECT thor_address, l1_address, chain FROM l1_addresses WHERE affiliate IS NOT TRUE`
		)
	).rows) {
		const list = links.get(r.thor_address);
		if (list) list.push(r.l1_address);
		else links.set(r.thor_address, [r.l1_address]);
		linkedAddresses++;
	}

	const verdictReasons = (address: string): Reason[] => {
		const readings = addressReadings(address);
		const out: Reason[] = [];
		for (const p of readings) out.push(...snap.reasonsForKey(p.key).filter(isActive));
		return out;
	};

	const results: UserVerdict[] = [];
	let hubsSkipped = 0;
	let direct = 0;
	let linkedOnly = 0;
	for (const thor of users) {
		const reasons: UserVerdict['reasons'] = [];
		for (const r of verdictReasons(thor)) {
			// linked reasons in the snapshot come from the previous run of this
			// function: recompute them from the links instead (no feedback loop)
			if (r.category === 'linked') continue;
			reasons.push({ via: thor, code: r.code, source: r.source, risk: r.risk, text: r.text });
		}
		const directMax = reasons.reduce((m, r) => Math.max(m, riskRank(r.risk)), 0);
		const l1s = links.get(thor) ?? [];
		const isHub = THORCHAIN_MODULES.has(thor) || l1s.length > hubLinks;
		if (isHub && l1s.length) hubsSkipped++;
		if (!isHub) {
			for (const l1 of l1s) {
				for (const r of verdictReasons(l1)) {
					if (r.category === 'traced' || r.category === 'key_twin') continue; // links to derived flags are too weak
					const risk = riskFromRank(Math.max(riskRank('low'), riskRank(r.risk) - 1));
					reasons.push({ via: l1, code: `LINKED_${r.code}`, source: r.source, risk, text: `Linked address ${l1}: ${r.text}` });
				}
			}
		}
		if (!reasons.length) continue;
		const max = reasons.reduce((m, r) => Math.max(m, riskRank(r.risk)), 0);
		const flagged = max >= flagAt;
		if (flagged) {
			if (directMax >= flagAt) direct++;
			else linkedOnly++;
		}
		results.push({ thor, risk: riskFromRank(max), flagged, reasons: reasons.sort((a, b) => riskRank(b.risk) - riskRank(a.risk)).slice(0, 10) });
	}

	// write back atomically: readers never see a half-updated flag set
	await withTransaction(sql, async (tx) => {
		await tx.query(`CREATE TEMP TABLE IF NOT EXISTS oz_user_verdicts (thor text PRIMARY KEY, flagged boolean, reason text, risk text, detail jsonb)`);
		await tx.query(`DELETE FROM oz_user_verdicts`);
		await batchInsert(
			tx,
			`INSERT INTO oz_user_verdicts (thor, flagged, reason, risk, detail)`,
			5,
			results.map((u) => [
				u.thor,
				u.flagged,
				u.reasons
					.slice(0, 3)
					.map((r) => `${r.source}: ${r.text}`)
					.join('; ')
					.slice(0, 1000),
				u.risk,
				JSON.stringify(u.reasons)
			])
		);
		// clear accounts that no longer have any reason (touch only those rows)
		await tx.query(
			`UPDATE rujira_users SET flagged = false, flag_reason = NULL, risk = NULL, flag_detail = NULL, screened_at = now()
			 WHERE (flagged OR flag_detail IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM oz_user_verdicts v WHERE v.thor = rujira_users.thor_address)`
		);
		// set the current verdicts (only rows whose verdict changed)
		await tx.query(
			`UPDATE rujira_users u SET flagged = v.flagged, flag_reason = v.reason, risk = v.risk, flag_detail = v.detail, screened_at = now()
			 FROM oz_user_verdicts v WHERE u.thor_address = v.thor
			   AND (u.flagged IS DISTINCT FROM v.flagged OR u.risk IS DISTINCT FROM v.risk OR u.flag_detail::text IS DISTINCT FROM v.detail::text)`
		);
		await tx.query(`DROP TABLE IF EXISTS oz_user_verdicts`);
	});

	return {
		accounts: users.length,
		thorAccounts: users.filter((u) => u.startsWith('thor1')).length,
		linkedAddresses,
		flagged: direct + linkedOnly,
		flaggedDirect: direct,
		flaggedLinked: linkedOnly,
		hubsSkipped
	};
}
