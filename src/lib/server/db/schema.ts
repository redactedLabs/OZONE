import {
	pgTable,
	serial,
	bigserial,
	bigint,
	text,
	timestamp,
	boolean,
	integer,
	jsonb,
	numeric,
	customType,
	index,
	primaryKey,
	unique,
	uniqueIndex
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const complianceEntries = pgTable('compliance_entries', {
	id: serial('id').primaryKey(),
	address: text('address').notNull(),
	chain: text('chain'),
	source: text('source').notNull(),
	entityName: text('entity_name'),
	reason: text('reason'),
	addedAt: timestamp('added_at').defaultNow(),
	lastSeen: timestamp('last_seen').defaultNow()
}, (table) => [
	uniqueIndex('compliance_addr_source_unique').on(table.address, table.source)
]);

export const rujiraUsers = pgTable('rujira_users', {
	id: serial('id').primaryKey(),
	thorAddress: text('thor_address').notNull().unique(),
	firstSeen: timestamp('first_seen').defaultNow(),
	lastSeen: timestamp('last_seen').defaultNow(),
	screenedAt: timestamp('screened_at'),
	l1FetchedAt: timestamp('l1_fetched_at'),
	flagged: boolean('flagged').default(false),
	flagReason: text('flag_reason'),
	// ozone-next: risk level and structured reasons (see packages/ozone-engine/src/screen/users.ts)
	risk: text('risk'),
	flagDetail: jsonb('flag_detail')
});

export const l1Addresses = pgTable('l1_addresses', {
	id: serial('id').primaryKey(),
	thorAddress: text('thor_address').notNull(),
	l1Address: text('l1_address').notNull(),
	chain: text('chain').notNull(),
	pool: text('pool'),
	affiliate: boolean('affiliate').default(false),
	discoveredAt: timestamp('discovered_at').defaultNow()
}, (table) => [
	uniqueIndex('l1_addr_unique').on(table.thorAddress, table.l1Address, table.chain)
]);

export const syncLog = pgTable('sync_log', {
	id: serial('id').primaryKey(),
	type: text('type').notNull(),
	status: text('status').notNull(),
	recordsProcessed: integer('records_processed'),
	flagsFound: integer('flags_found'),
	error: text('error'),
	duration: integer('duration'),
	createdAt: timestamp('created_at').defaultNow()
});

// Transactions observed from THORChain WebSocket
export const transactions = pgTable('transactions', {
	id: serial('id').primaryKey(),
	txHash: text('tx_hash').unique().notNull(),
	blockHeight: integer('block_height'),
	memo: text('memo'),
	memoType: text('memo_type'), // SWAP | ADD | WITHDRAW | RUJIRA | OTHER
	fromAddress: text('from_address'),
	toAddress: text('to_address'),
	asset: text('asset'),
	amount: text('amount'),
	chain: text('chain'),
	timestamp: timestamp('timestamp').defaultNow(),
	processed: boolean('processed').default(false)
});

// Compliance certificates
export const certificates = pgTable('certificates', {
	id: serial('id').primaryKey(),
	certId: text('cert_id').notNull().unique(),
	address: text('address').notNull(),
	flagged: boolean('flagged').default(false),
	sourcesChecked: integer('sources_checked').default(8),
	issuedAt: timestamp('issued_at').defaultNow(),
	// ozone-next: server-computed verdict + signed certificate document
	chain: text('chain'),
	risk: text('risk'),
	snapshotVersion: bigint('snapshot_version', { mode: 'number' }),
	document: jsonb('document')
});

// Shareable transaction reports
export const reports = pgTable('reports', {
	id: serial('id').primaryKey(),
	reportId: text('report_id').notNull().unique(),
	address: text('address').notNull(), // stored but never shown publicly unless revealWallet
	dateFrom: timestamp('date_from'),
	dateTo: timestamp('date_to'),
	includeNew: boolean('include_new').default(false), // live: include txs after creation
	revealWallet: boolean('reveal_wallet').default(false), // show address in shared report
	txCount: integer('tx_count').default(0),
	txData: text('tx_data'), // JSON stringified transactions
	createdAt: timestamp('created_at').defaultNow(),
});

// Admin manual flaglist
export const manualFlags = pgTable('manual_flags', {
	id: serial('id').primaryKey(),
	address: text('address').notNull(),
	chain: text('chain'),
	reason: text('reason').notNull(),
	addedBy: text('added_by'),
	addedAt: timestamp('added_at').defaultNow(),
	active: boolean('active').default(true)
});

export const user = pgTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').default(false),
	image: text('image'),
	role: text('role').default('admin'), // 'owner' | 'admin'
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow()
});

export const session = pgTable('session', {
	id: text('id').primaryKey(),
	expiresAt: timestamp('expires_at').notNull(),
	token: text('token').notNull().unique(),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	userId: text('user_id')
		.notNull()
		.references(() => user.id)
});

export const account = pgTable('account', {
	id: text('id').primaryKey(),
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	idToken: text('id_token'),
	accessTokenExpiresAt: timestamp('access_token_expires_at'),
	refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
	scope: text('scope'),
	password: text('password'),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow()
});

export const verification = pgTable('verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: timestamp('expires_at').notNull(),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow()
});

export const privacySnapshots = pgTable('privacy_snapshots', {
	id: serial('id').primaryKey(),
	tvlUsd: text('tvl_usd').notNull(),
	walletCount: integer('wallet_count').notNull(),
	revenueUsd: text('revenue_usd').notNull(),
	cumulativeFeesUsd: text('cumulative_fees_usd'),
	cumulativeFeesAssets: jsonb('cumulative_fees_assets').$type<Array<{ asset: string; amount: number }>>(),
	cumulativeVolumeUsd: text('cumulative_volume_usd'),
	cumulativeVolumeAssets: jsonb('cumulative_volume_assets').$type<Array<{ asset: string; amount: number }>>(),
	createdAt: timestamp('created_at').defaultNow()
});

// ---------------------------------------------------------------------------
// ozone-next tables. The SQL source of truth (idempotent, additive) is
// packages/ozone-engine/migrations/0001_ozone_next.sql and the later 000N
// files; these definitions keep `drizzle-kit push` and typed queries in sync
// with it.
// ---------------------------------------------------------------------------

export const ozSources = pgTable('oz_sources', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	kind: text('kind').notNull(),
	url: text('url'),
	lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
	lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
	lastError: text('last_error'),
	lastVersion: text('last_version'),
	activeCount: integer('active_count').notNull().default(0),
	removedCount: integer('removed_count').notNull().default(0),
	rejectedCount: integer('rejected_count').notNull().default(0),
	notes: jsonb('notes'),
	state: jsonb('state')
});

export const ozEntries = pgTable(
	'oz_entries',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		source: text('source').notNull(),
		key: text('key').notNull(),
		chain: text('chain').notNull(),
		address: text('address').notNull(),
		category: text('category').notNull(),
		risk: text('risk').notNull(),
		code: text('code').notNull(),
		entity: text('entity'),
		reason: text('reason').notNull(),
		refUrl: text('ref_url'),
		refId: text('ref_id'),
		listedAt: timestamp('listed_at', { withTimezone: true }),
		firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
		lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
		removedAt: timestamp('removed_at', { withTimezone: true }),
		meta: jsonb('meta')
	},
	(t) => [
		unique('oz_entries_source_key').on(t.source, t.key),
		index('oz_entries_key_idx').on(t.key),
		index('oz_entries_active_idx').on(t.source).where(sql`removed_at IS NULL`)
	]
);

export const ozTraceEdges = pgTable(
	'oz_trace_edges',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		txid: text('txid').notNull(),
		fromKey: text('from_key').notNull(),
		fromAddress: text('from_address').notNull(),
		fromChain: text('from_chain').notNull(),
		toKey: text('to_key').notNull(),
		toChain: text('to_chain').notNull(),
		toAddress: text('to_address').notNull(),
		action: text('action').notNull(),
		relation: text('relation').notNull(),
		height: bigint('height', { mode: 'number' }),
		ts: timestamp('ts', { withTimezone: true }),
		amount: text('amount'),
		usd: numeric('usd'),
		hop: integer('hop').notNull(),
		risk: text('risk').notNull(),
		originKey: text('origin_key').notNull(),
		originSource: text('origin_source').notNull(),
		originEntity: text('origin_entity'),
		originRisk: text('origin_risk').notNull(),
		originCategory: text('origin_category').notNull(),
		reason: text('reason').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('oz_trace_edges_unique').on(t.txid, t.fromKey, t.toKey),
		index('oz_trace_edges_to_idx').on(t.toKey),
		index('oz_trace_edges_from_idx').on(t.fromKey),
		index('oz_trace_edges_ts_idx').on(t.ts)
	]
);

export const ozTraced = pgTable('oz_traced', {
	key: text('key').primaryKey(),
	chain: text('chain').notNull(),
	address: text('address').notNull(),
	hop: integer('hop').notNull(),
	risk: text('risk').notNull(),
	usd: numeric('usd'),
	originKey: text('origin_key').notNull(),
	originSource: text('origin_source').notNull(),
	originEntity: text('origin_entity'),
	originRisk: text('origin_risk').notNull(),
	originCategory: text('origin_category').notNull(),
	firstTxid: text('first_txid').notNull(),
	firstHeight: bigint('first_height', { mode: 'number' }),
	firstTs: timestamp('first_ts', { withTimezone: true }),
	edges: integer('edges').notNull().default(1),
	service: boolean('service').notNull().default(false),
	suppressed: boolean('suppressed').notNull().default(false),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

// Superseded by oz_trace_dust_flows (0003): no longer read or written, kept
// because the migrations are additive only (0002_trace_dust_totals.sql).
export const ozTraceDustTotals = pgTable(
	'oz_trace_dust_totals',
	{
		originKey: text('origin_key').notNull(),
		toKey: text('to_key').notNull(),
		hop: integer('hop').notNull(),
		usd: numeric('usd').notNull().default('0'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ name: 'oz_trace_dust_totals_pkey', columns: [t.originKey, t.toKey, t.hop] })]
);

// Value flows under the dust limit, one row per flow (0003_trace_dust_flows.sql).
export const ozTraceDustFlows = pgTable(
	'oz_trace_dust_flows',
	{
		txid: text('txid').notNull(),
		fromKey: text('from_key').notNull(),
		fromAddress: text('from_address').notNull(),
		fromChain: text('from_chain').notNull(),
		toKey: text('to_key').notNull(),
		toChain: text('to_chain').notNull(),
		toAddress: text('to_address').notNull(),
		action: text('action').notNull(),
		height: bigint('height', { mode: 'number' }),
		ts: timestamp('ts', { withTimezone: true }),
		amount: text('amount'),
		usd: numeric('usd').notNull(),
		hop: integer('hop').notNull(),
		originKey: text('origin_key').notNull(),
		originSource: text('origin_source').notNull(),
		originEntity: text('origin_entity'),
		originRisk: text('origin_risk').notNull(),
		originCategory: text('origin_category').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ name: 'oz_trace_dust_flows_pkey', columns: [t.txid, t.fromKey, t.toKey] }),
		index('oz_trace_dust_flows_group_idx').on(t.originKey, t.toKey, t.hop),
		index('oz_trace_dust_flows_to_idx').on(t.toKey)
	]
);

export const ozTraceChecked = pgTable('oz_trace_checked', {
	key: text('key').primaryKey(),
	checkedHeight: bigint('checked_height', { mode: 'number' }).notNull().default(0),
	checkedAt: timestamp('checked_at', { withTimezone: true }),
	actions: integer('actions').notNull().default(0),
	status: text('status').notNull().default('pending'),
	error: text('error')
});

export const ozState = pgTable('oz_state', {
	id: text('id').primaryKey(),
	value: jsonb('value').notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const ozSnapshots = pgTable('oz_snapshots', {
	version: bigint('version', { mode: 'number' }).primaryKey(),
	builtAt: timestamp('built_at', { withTimezone: true }).notNull(),
	sha256: text('sha256').notNull(),
	size: integer('size').notNull(),
	manifest: jsonb('manifest').notNull(),
	payload: bytea('payload').notNull(),
	stats: jsonb('stats'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const ozSubmissions = pgTable(
	'oz_submissions',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		publicId: text('public_id').notNull().unique(),
		kind: text('kind').notNull(),
		address: text('address').notNull(),
		chain: text('chain'),
		key: text('key'),
		message: text('message').notNull(),
		evidence: text('evidence'),
		contact: text('contact'),
		status: text('status').notNull().default('open'),
		resolution: text('resolution'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		resolvedAt: timestamp('resolved_at', { withTimezone: true }),
		resolvedBy: text('resolved_by')
	},
	(t) => [index('oz_submissions_status_idx').on(t.status, t.createdAt)]
);

export const ozOverrides = pgTable('oz_overrides', {
	key: text('key').primaryKey(),
	action: text('action').notNull().default('suppress'),
	reason: text('reason').notNull(),
	createdBy: text('created_by'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	active: boolean('active').notNull().default(true)
});
