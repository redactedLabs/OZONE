import { readFileSync } from 'node:fs';
import type { Sql } from '../types.js';

/** Inserts rows in batches with numbered parameters (`$1…`). */
export async function batchInsert(
	sql: Sql,
	head: string,
	columns: number,
	rows: unknown[][],
	tail = '',
	batchSize = Math.max(1, Math.floor(30000 / Math.max(1, columns)))
): Promise<number> {
	let n = 0;
	for (let i = 0; i < rows.length; i += batchSize) {
		const chunk = rows.slice(i, i + batchSize);
		const params: unknown[] = [];
		const values = chunk
			.map((r) => {
				if (r.length !== columns) throw new Error(`batchInsert: expected ${columns} columns, got ${r.length}`);
				const ph = r.map((v) => {
					params.push(v);
					return `$${params.length}`;
				});
				return `(${ph.join(',')})`;
			})
			.join(',');
		await sql.query(`${head} VALUES ${values} ${tail}`, params);
		n += chunk.length;
	}
	return n;
}

export const MIGRATIONS = ['0000_baseline.sql', '0001_ozone_next.sql', '0002_trace_dust_totals.sql'];

export function migrationText(name: string): string {
	return readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');
}

/**
 * Applies SQL files statement by statement (the files contain no functions
 * or `;` inside literals). `0000_baseline.sql` recreates the tables the
 * existing app already has — only for local/test databases.
 */
export async function migrate(sql: Sql, opts: { baseline?: boolean } = {}): Promise<void> {
	for (const name of MIGRATIONS) {
		if (name.startsWith('0000') && !opts.baseline) continue;
		const text = migrationText(name)
			.split('\n')
			.filter((l) => !l.trim().startsWith('--'))
			.join('\n');
		for (const stmt of text.split(/;\s*(?:\n|$)/)) {
			if (stmt.trim()) await sql.query(stmt);
		}
	}
}

export const toDate = (v: unknown): Date | null => (v ? new Date(v as string) : null);
export const isoOf = (v: unknown): string | undefined => (v ? new Date(v as string).toISOString() : undefined);

/**
 * Runs `fn` in one transaction: on a dedicated client for a pg Pool, via
 * `transaction()` for PGlite, or directly for a plain client.
 */
export async function withTransaction<T>(sql: Sql, fn: (tx: Sql) => Promise<T>): Promise<T> {
	const s = sql as Sql & {
		connect?: () => Promise<Sql & { release: () => void }>;
		transaction?: <R>(cb: (tx: Sql) => Promise<R>) => Promise<R>;
		totalCount?: number;
	};
	if (typeof s.connect === 'function' && typeof s.totalCount === 'number') {
		const client = await s.connect();
		try {
			await client.query('BEGIN');
			const r = await fn(client);
			await client.query('COMMIT');
			return r;
		} catch (e) {
			await client.query('ROLLBACK').catch(() => undefined);
			throw e;
		} finally {
			client.release();
		}
	}
	if (typeof s.transaction === 'function') return s.transaction((tx) => fn(tx));
	return fn(sql);
}
