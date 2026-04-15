import {
	pgTable,
	serial,
	text,
	timestamp,
	boolean,
	integer,
	jsonb,
	uniqueIndex
} from 'drizzle-orm/pg-core';

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
	flagReason: text('flag_reason')
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
