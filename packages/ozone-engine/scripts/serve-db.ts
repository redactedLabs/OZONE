/**
 * Serves the local engine database (PGlite) over the Postgres wire protocol
 * so the SvelteKit app can run against it locally:
 *
 *   npx tsx packages/ozone-engine/scripts/serve-db.ts            # 127.0.0.1:54329
 *   DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres pnpm dev
 *
 * Local development only — binds to 127.0.0.1.
 */
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { migrate, type Sql } from '../src/index.js';

const dataDir = resolve(process.env.OZONE_LOCAL_DB ?? '.ozone-local/pgdata');
const port = Number(process.env.PORT ?? 54329);

const db = await PGlite.create(dataDir);
await migrate(db as unknown as Sql, { baseline: true });
// the app's own tables that the engine baseline does not create
await db.exec(`
	CREATE TABLE IF NOT EXISTS "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, email_verified boolean DEFAULT false,
		image text, role text DEFAULT 'admin', created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());
	CREATE TABLE IF NOT EXISTS session (id text PRIMARY KEY, expires_at timestamp NOT NULL, token text NOT NULL UNIQUE, created_at timestamp DEFAULT now(),
		updated_at timestamp DEFAULT now(), ip_address text, user_agent text, user_id text NOT NULL REFERENCES "user"(id));
	CREATE TABLE IF NOT EXISTS transactions (id serial PRIMARY KEY, tx_hash text UNIQUE NOT NULL, block_height integer, memo text, memo_type text,
		from_address text, to_address text, asset text, amount text, chain text, timestamp timestamp DEFAULT now(), processed boolean DEFAULT false);
	CREATE TABLE IF NOT EXISTS reports (id serial PRIMARY KEY, report_id text NOT NULL UNIQUE, address text NOT NULL, date_from timestamp, date_to timestamp,
		include_new boolean DEFAULT false, reveal_wallet boolean DEFAULT false, tx_count integer DEFAULT 0, tx_data text, created_at timestamp DEFAULT now());
`);
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 10 } as ConstructorParameters<typeof PGLiteSocketServer>[0]);
await server.start();
console.log(`PGlite (${dataDir}) on postgres://postgres@127.0.0.1:${port}/postgres`);
const stop = async () => {
	await server.stop();
	await db.close();
	process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
