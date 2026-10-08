/**
 * The worker's upstream discipline (pass G): one daily Midgard budget with
 * priorities (Liquify's free gateway allows ~50,000 requests a day; the
 * worker's discovery alone used more, and the follower stalled on
 * 2026-10-04), THORNode over Redacted's own endpoints with the public gateway
 * behind them, and the health verdict an uptime monitor watches.
 */
import { describe, expect, it } from 'vitest';
import { DailyQuota, QuotaDenied } from '../src/util/quota.js';
import { FailoverJson } from '../src/util/failover.js';
import { Midgard } from '../src/trace/midgard.js';
import { Chain } from '../src/trace/chain.js';
import { thornodeApiUrls, REDACTED_THORNODE_API, LIQUIFY_THORNODE_API } from '../src/explorers/thornode.js';
import { healthVerdict, HEALTH_LIMITS } from '../src/health.js';
import { CORE_SOURCES } from '../src/sources/registry.js';

describe('daily request budget', () => {
	it('keeps an hour of requests, refills at the daily rate, and reserves the bucket for the follower', () => {
		let t = Date.parse('2026-10-07T12:00:00Z');
		const q = new DailyQuota({ dailyLimit: 24_000, now: () => t }); // 1,000 an hour, starts half full
		let backfill = 0;
		while (q.tryTake('backfill')) backfill++;
		// backfill stops at half the bucket: it starts there, so it gets nothing until the bucket refills
		expect(backfill).toBe(0);
		let links = 0;
		while (q.tryTake('links')) links++;
		expect(links).toBe(150); // from 500 down to the 35 % reserve (350)
		let realtime = 0;
		while (q.tryTake('realtime')) realtime++;
		expect(realtime).toBe(350); // the rest
		// an hour later the bucket is full again: backfill may use what is above half
		t += 3600_000;
		backfill = 0;
		while (q.tryTake('backfill')) backfill++;
		expect(backfill).toBeGreaterThanOrEqual(499);
		expect(backfill).toBeLessThanOrEqual(500);
		const u = q.snapshot();
		expect(u.requestsToday).toBe(150 + 350 + backfill);
		expect(u.byPriority).toEqual({ realtime: 350, links: 150, backfill });
	});

	it('a 429 pauses links and backfill for five minutes; the follower keeps going', () => {
		let t = Date.parse('2026-10-07T12:00:00Z');
		const q = new DailyQuota({ dailyLimit: 48_000, now: () => t });
		t += 3600_000; // full bucket
		expect(q.tryTake('backfill')).toBe(true);
		q.failure(429, 'HTTP 429');
		expect(q.tryTake('backfill')).toBe(false);
		expect(q.tryTake('links')).toBe(false);
		expect(q.tryTake('realtime')).toBe(true);
		t += 5 * 60_000 + 1;
		expect(q.tryTake('links')).toBe(true);
		const u = q.snapshot();
		expect(u.last429At).toBeDefined();
		expect(u.rateLimitedToday).toBe(1);
		expect(u.failingSince).toBeDefined();
		q.success();
		expect(q.snapshot().failingSince).toBeUndefined();
	});

	it('the daily limit stops links and backfill; the follower may go 20 % beyond it; counters reset at UTC midnight and survive a restart', async () => {
		let t = Date.parse('2026-10-07T23:00:00Z');
		const q = new DailyQuota({ dailyLimit: 1_000, now: () => t });
		q.restore({ day: '2026-10-07', requestsToday: 1_000, byPriority: { realtime: 400, links: 300, backfill: 300 } });
		t += 3600_000 - 1; // bucket full, still the 7th
		expect(q.tryTake('links')).toBe(false);
		expect(await q.take('backfill', 10_000)).toBe(false); // no waiting for a limit that only midnight lifts
		expect(q.tryTake('realtime')).toBe(true);
		expect(q.snapshot().deniedToday).toBe(1);
		t += 2;
		expect(q.snapshot().day).toBe('2026-10-08');
		expect(q.tryTake('links')).toBe(true);
		expect(q.snapshot().requestsToday).toBe(1);
		await expect(new DailyQuota({ dailyLimit: 1_000, now: () => t }).require('backfill', 0)).rejects.toBeInstanceOf(QuotaDenied);
	});
});

describe('Midgard on the budget', () => {
	it('every request and retry takes from the budget, with the priority of its view', async () => {
		let t = Date.parse('2026-10-07T12:00:00Z');
		const quota = new DailyQuota({ dailyLimit: 24_000, now: () => t });
		t += 3600_000;
		let calls = 0;
		const fetchImpl = (async () => {
			calls++;
			return calls === 1 ? new Response('busy', { status: 503 }) : new Response(JSON.stringify({ actions: [], meta: {} }));
		}) as typeof fetch;
		const base = new Midgard({ baseUrl: 'https://midgard.test', minIntervalMs: 0, quota, http: { fetch: fetchImpl, retries: 1 } });
		await base.withPriority('realtime').actions({ limit: 1 });
		expect(calls).toBe(2);
		expect(quota.snapshot().byPriority.realtime).toBe(2);
		await base.withPriority('links').actions({ limit: 1 });
		expect(quota.snapshot().byPriority.links).toBe(1);
	});

	it('a priority without budget is refused (QuotaDenied), not retried against the gateway', async () => {
		const t = Date.parse('2026-10-07T12:00:00Z');
		const quota = new DailyQuota({ dailyLimit: 24_000, now: () => t });
		let calls = 0;
		const fetchImpl = (async () => {
			calls++;
			return new Response(JSON.stringify({ actions: [] }));
		}) as typeof fetch;
		const m = new Midgard({ baseUrl: 'https://midgard.test', minIntervalMs: 0, quota, maxQuotaWaitMs: 0, http: { fetch: fetchImpl } }).withPriority('backfill');
		await expect(m.actions({ address: 'x' })).rejects.toBeInstanceOf(QuotaDenied);
		expect(calls).toBe(0);
	});
});

describe('THORNode endpoints', () => {
	it('maps known public gateways to ours with the gateway behind; keeps any other value', () => {
		expect(thornodeApiUrls(undefined)).toEqual([REDACTED_THORNODE_API, LIQUIFY_THORNODE_API]);
		expect(thornodeApiUrls('https://thornode.ninerealms.com/')).toEqual([REDACTED_THORNODE_API, LIQUIFY_THORNODE_API]);
		expect(thornodeApiUrls(LIQUIFY_THORNODE_API)).toEqual([REDACTED_THORNODE_API, LIQUIFY_THORNODE_API]);
		expect(thornodeApiUrls('http://my-node:1317')).toEqual(['http://my-node:1317', LIQUIFY_THORNODE_API]);
	});

	it('fails over on 429/503 and network errors, cools the endpoint down, and comes back to it', async () => {
		let t = 1_000_000;
		const seen: string[] = [];
		let oursDown = true;
		const fetchImpl = (async (input: string | URL | Request) => {
			const url = String(input);
			seen.push(new URL(url).host);
			if (url.startsWith('https://ours.test')) return oursDown ? new Response('slow down', { status: 429 }) : new Response(JSON.stringify({ from: 'ours' }));
			return new Response(JSON.stringify({ from: 'fallback' }));
		}) as typeof fetch;
		const f = new FailoverJson({ urls: ['https://ours.test', 'https://fallback.test'], minIntervalMs: 0, maxRetryAfterMs: 1, now: () => t, http: { fetch: fetchImpl } });
		expect(await f.get<{ from: string }>('/x')).toEqual({ from: 'fallback' });
		expect(seen).toEqual(['ours.test', 'ours.test', 'fallback.test']); // one retry on ours, then the fallback
		seen.length = 0;
		expect(await f.get<{ from: string }>('/x')).toEqual({ from: 'fallback' });
		expect(seen).toEqual(['fallback.test']); // ours is cooling down
		expect(f.status()[0].downUntil).toBeDefined();
		oursDown = false;
		t += 31_000;
		expect(await f.get<{ from: string }>('/x')).toEqual({ from: 'ours' });
	});

	it('history our node does not hold (state-synced from a height) is read from the gateway', async () => {
		const seen: string[] = [];
		const fetchImpl = (async (input: string | URL | Request) => {
			const url = new URL(String(input));
			seen.push(`${url.host} ${url.searchParams.get('query')}`);
			return new Response(JSON.stringify({ tx_responses: [], total: '0' }));
		}) as typeof fetch;
		const chain = new Chain({ baseUrls: ['https://ours.test', 'https://gateway.test'], minIntervalMs: 0, http: { fetch: fetchImpl } });
		chain.setFloor('https://ours.test', 28_080_001);
		for await (const _ of chain.wasmTxs({ fromHeight: 28_146_000 })) void _;
		for await (const _ of chain.wasmTxs({ fromHeight: 20_000_000, signer: 'thor1dheycdevq39qlkxs2a6wuuzyn4aqxhve4qxtxt' })) void _;
		expect(seen[0]).toMatch(/^ours\.test /);
		expect(seen[1]).toMatch(/^gateway\.test .*tx\.height>=20000000/);
	});
});

describe('health verdict', () => {
	const now = Date.parse('2026-10-07T21:00:00Z');
	const ago = (ms: number) => new Date(now - ms).toISOString();
	const fresh = {
		now,
		snapshot: { builtAt: ago(3 * 3600_000) },
		realtime: { updatedAt: ago(20_000) },
		sources: CORE_SOURCES.map((id) => ({ id, lastSuccessAt: ago(3600_000), lastError: null })),
		coreSources: CORE_SOURCES,
		midgard: { lastSuccessAt: ago(10_000), updatedAt: ago(30_000) }
	};

	it('ok while everything moves; a failing non-core source is a warning', () => {
		const v = healthVerdict({ ...fresh, sources: [...fresh.sources, { id: 'tether_usdt0', lastSuccessAt: ago(40 * 3600_000), lastError: 'HTTP 403' }] });
		expect(v).toMatchObject({ ok: true, reasons: [] });
		expect(v.warnings[0]).toMatch(/tether_usdt0 is failing.*HTTP 403/);
	});

	it('the four stall conditions, each with its reason', () => {
		expect(healthVerdict({ ...fresh, realtime: { updatedAt: ago(16 * 60_000) } }).reasons).toEqual([expect.stringMatching(/real-time follower has not moved for 16 min/)]);
		const stale = fresh.sources.map((s) => (s.id === 'circle' ? { ...s, lastSuccessAt: ago(39 * 3600_000), lastError: 'HTTP 403' } : s));
		expect(healthVerdict({ ...fresh, sources: stale }).reasons).toEqual([expect.stringMatching(/core source circle has not synced for 39\.0 h \(limit 24 h\): HTTP 403/)]);
		const failing = { ...fresh.midgard, lastSuccessAt: ago(70 * 60_000), failingSince: ago(70 * 60_000) };
		expect(healthVerdict({ ...fresh, midgard: failing }).reasons).toEqual([expect.stringMatching(/every Midgard request has failed for 70 min/)]);
		expect(healthVerdict({ ...fresh, snapshot: { builtAt: ago(7 * 3600_000) } }).reasons).toEqual([expect.stringMatching(/newest snapshot is 7\.0 h old/)]);
	});

	it('Midgard counters the worker no longer refreshes are not a verdict (the follower check covers a dead worker)', () => {
		const old = { lastSuccessAt: ago(5 * 3600_000), failingSince: ago(5 * 3600_000), updatedAt: ago(HEALTH_LIMITS.midgardStateFreshMs + 60_000) };
		expect(healthVerdict({ ...fresh, midgard: old }).ok).toBe(true);
		expect(healthVerdict({ ...fresh, midgard: null }).ok).toBe(true);
	});

	it('no snapshot, or a core source never synced: not ok', () => {
		expect(healthVerdict({ ...fresh, snapshot: null }).reasons[0]).toMatch(/no signed snapshot/);
		expect(healthVerdict({ ...fresh, sources: fresh.sources.filter((s) => s.id !== 'fbi') }).reasons[0]).toMatch(/core source fbi has never synced/);
	});
});
