/**
 * Local driver for the Ozone engine against an embedded Postgres (PGlite).
 * Never touches a remote database.
 *
 *   npx tsx packages/ozone-engine/scripts/ozone.ts <command> [args]
 *
 * Commands:
 *   sync [source…]            fetch + apply lists (default: all)
 *   cluster [--max-requests N] expand hack clusters on Ethereum (Blockscout)
 *   trace [--minutes M] [--max N] [--only ns|source] [--concurrency C]
 *                             THORChain history backfill (Midgard)
 *   tick                      one real-time follower step
 *   snapshot                  build + sign a snapshot (local dev key)
 *   users                     flag THORChain users from the latest snapshot
 *   screen <address> [chain]  verdict from the latest snapshot
 *   stats [--json]            coverage report
 *   export <dir>              write latest manifest + payload to <dir>
 *
 * Environment: OZONE_LOCAL_DB (default .ozone-local/pgdata),
 * OZONE_SNAPSHOT_SIGNING_KEY (default: a dev key in .ozone-local/dev-key.hex),
 * MIDGARD_URL.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { generateSigningKey, loadPrivateKey } from '../../ozone-client/src/index.js';
import {
	consoleLogger,
	latestSnapshot,
	loadLatestIndex,
	Midgard,
	migrate,
	publishSnapshot,
	runClusterExpansion,
	runRealtimeTick,
	runTraceBackfill,
	screenUsersFromLatest,
	snapshotPayload,
	syncAllSources,
	type Sql
} from '../src/index.js';
import { coverageReport } from '../src/report.js';

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};

const dataDir = resolve(process.env.OZONE_LOCAL_DB ?? '.ozone-local/pgdata');
mkdirSync(dataDir, { recursive: true });

function devKey() {
	if (process.env.OZONE_SNAPSHOT_SIGNING_KEY) return loadPrivateKey(process.env.OZONE_SNAPSHOT_SIGNING_KEY);
	const file = join(dataDir, '..', 'dev-key.hex');
	if (!existsSync(file)) writeFileSync(file, generateSigningKey().seedHex + '\n', { mode: 0o600 });
	return loadPrivateKey(readFileSync(file, 'utf8').trim());
}

async function main() {
	const db = await PGlite.create(dataDir);
	const sql = db as unknown as Sql;
	await migrate(sql, { baseline: true });
	const midgard = new Midgard({ baseUrl: process.env.MIDGARD_URL, minIntervalMs: Number(flag('interval') ?? 350), concurrency: 2 });
	const t0 = Date.now();
	switch (cmd) {
		case 'sync': {
			const only = args.slice(1).filter((a) => !a.startsWith('--'));
			const out = await syncAllSources(sql, { logger: consoleLogger }, only.length ? only : undefined);
			console.table(out.map((o) => ({ source: o.source, ok: o.ok, active: o.stats?.active, new: o.stats?.inserted, delisted: o.stats?.removed, rejected: o.stats?.rejected, ms: o.durationMs, error: o.error?.slice(0, 80) })));
			break;
		}
		case 'cluster': {
			const r = await runClusterExpansion(sql, { logger: consoleLogger, maxRequests: Number(flag('max-requests') ?? 20000) });
			console.log(r);
			break;
		}
		case 'trace': {
			const only = flag('only');
			const r = await runTraceBackfill(sql, midgard, {
				logger: consoleLogger,
				timeBudgetMs: Number(flag('minutes') ?? 30) * 60_000,
				maxAddresses: Number(flag('max') ?? Infinity),
				concurrency: Number(flag('concurrency') ?? 2),
				filter: only ? (key, e) => key.startsWith(`${only}:`) || e.originSource === only : undefined
			});
			console.log(r, `midgard requests: ${midgard.requests}`);
			break;
		}
		case 'tick': {
			console.log(await runRealtimeTick(sql, midgard));
			break;
		}
		case 'snapshot': {
			const key = devKey();
			const s = await publishSnapshot(sql, key);
			console.log({ version: s.version, size: s.size, stats: s.stats, keyId: key.publicKey.keyId, publicKey: key.publicKey.spec });
			break;
		}
		case 'users': {
			console.log(await screenUsersFromLatest(sql));
			break;
		}
		case 'screen': {
			const index = await loadLatestIndex(sql);
			if (!index) throw new Error('no snapshot; run `snapshot` first');
			console.log(JSON.stringify(index.screen(args[1], args[2]), null, 2));
			break;
		}
		case 'stats': {
			const report = await coverageReport(sql);
			console.log(flag('json') !== undefined || args.includes('--json') ? JSON.stringify(report, null, 2) : report);
			break;
		}
		case 'export': {
			const dir = resolve(args[1] ?? '.ozone-local/export');
			const latest = await latestSnapshot(sql);
			if (!latest) throw new Error('no snapshot');
			mkdirSync(join(dir, 'snapshot'), { recursive: true });
			writeFileSync(join(dir, 'latest.json'), JSON.stringify(latest.manifest, null, 2));
			writeFileSync(join(dir, 'snapshot', String(latest.version)), (await snapshotPayload(sql, latest.version))!);
			console.log(`wrote ${dir}/latest.json and snapshot/${latest.version}`);
			break;
		}
		default:
			console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
	}
	console.error(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
	await db.close();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
