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
 *   keygen <file>             new Ed25519 signing key: secret seed → <file> (mode 600),
 *                             prints only the public key (for OZONE_*_SIGNING_KEY / pinning)
 *
 * Environment: OZONE_LOCAL_DB (default .ozone-local/pgdata),
 * OZONE_SNAPSHOT_SIGNING_KEY (default: a dev key in .ozone-local/dev-key.hex),
 * MIDGARD_URL.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
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
if (cmd !== 'keygen') mkdirSync(dataDir, { recursive: true });

function devKey() {
	if (process.env.OZONE_SNAPSHOT_SIGNING_KEY) return loadPrivateKey(process.env.OZONE_SNAPSHOT_SIGNING_KEY);
	const file = join(dataDir, '..', 'dev-key.hex');
	if (!existsSync(file)) writeFileSync(file, generateSigningKey().seedHex + '\n', { mode: 0o600 });
	return loadPrivateKey(readFileSync(file, 'utf8').trim());
}

function keygen(file: string | undefined) {
	if (!file) throw new Error('usage: keygen <file>   (the secret seed is written there, never printed)');
	const seed = generateSigningKey().seedHex;
	writeFileSync(file, seed + '\n', { mode: 0o600, flag: 'wx' }); // 'wx': never overwrite a key
	const key = loadPrivateKey(seed);
	console.log(JSON.stringify({ secretSeedFile: resolve(file), publicKey: key.publicKey.spec, keyId: key.publicKey.keyId }, null, 2));
}

async function main() {
	if (cmd === 'keygen') return keygen(args[1]);
	const db = await PGlite.create(dataDir);
	const sql = db as unknown as Sql;
	await migrate(sql, { baseline: true });
	// --serve: also expose the database on 127.0.0.1:54329 while the command runs
	// (PGlite is single-process; this lets the app read it at the same time)
	let server: PGLiteSocketServer | undefined;
	if (args.includes('--serve')) {
		server = new PGLiteSocketServer({ db, port: Number(process.env.PORT ?? 54329), host: '127.0.0.1', maxConnections: 10 });
		await server.start();
		console.error('serving postgres://postgres@127.0.0.1:54329/postgres');
	}
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
			// --cluster-depth N: only hack clusters — their seeds (FBI list, "… Exploiter"
			// labels) and members up to depth N — and what they flag
			const depth = flag('cluster-depth');
			const clusterKeys = depth
				? new Set(
						(
							await sql.query<{ key: string }>(
								`SELECT key FROM oz_entries WHERE removed_at IS NULL AND (
								   (source = 'cluster' AND (meta->>'depth')::int <= $1)
								   OR source = 'fbi'
								   OR (source = 'ethlabels' AND entity LIKE '%Exploiter%'))`,
								[Number(depth)]
							)
						).rows.map((r) => r.key)
					)
				: undefined;
			const r = await runTraceBackfill(sql, midgard, {
				logger: consoleLogger,
				timeBudgetMs: Number(flag('minutes') ?? 30) * 60_000,
				maxAddresses: Number(flag('max') ?? Infinity),
				concurrency: Number(flag('concurrency') ?? 2),
				filter: clusterKeys
					? (key, e) => clusterKeys.has(key) || clusterKeys.has(e.originKey)
					: only
						? (key, e) => key.startsWith(`${only}:`) || e.originSource === only
						: undefined
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
			const payload = (await snapshotPayload(sql, latest.version))!;
			writeFileSync(join(dir, 'snapshot', String(latest.version)), payload);
			let off = 0;
			(latest.manifest.payload.parts ?? []).forEach((p, i) => {
				writeFileSync(join(dir, 'snapshot', `${latest.version}.${i}`), payload.subarray(off, off + p.size));
				off += p.size;
			});
			console.log(`wrote ${dir}/latest.json and snapshot/${latest.version}${latest.manifest.payload.parts ? ` (+${latest.manifest.payload.parts.length} parts)` : ''}`);
			break;
		}
		default:
			console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
	}
	console.error(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
	await server?.stop();
	await db.close();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
