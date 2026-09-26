-- Ozone next: provenance-carrying list entries, THORChain flow tracing,
-- signed snapshots, reports/appeals. Additive and idempotent: safe to apply
-- to the live database while the current app and worker keep running (no
-- existing table or column is changed or dropped).

CREATE TABLE IF NOT EXISTS oz_sources (
	id text PRIMARY KEY,
	name text NOT NULL,
	kind text NOT NULL,
	url text,
	last_attempt_at timestamptz,
	last_success_at timestamptz,
	last_error text,
	last_version text,
	active_count integer NOT NULL DEFAULT 0,
	removed_count integer NOT NULL DEFAULT 0,
	rejected_count integer NOT NULL DEFAULT 0,
	notes jsonb,
	state jsonb
);

-- One row per (source, address). removed_at IS NULL = currently listed.
CREATE TABLE IF NOT EXISTS oz_entries (
	id bigserial PRIMARY KEY,
	source text NOT NULL,
	key text NOT NULL,
	chain text NOT NULL,
	address text NOT NULL,
	category text NOT NULL,
	risk text NOT NULL,
	code text NOT NULL,
	entity text,
	reason text NOT NULL,
	ref_url text,
	ref_id text,
	listed_at timestamptz,
	first_seen timestamptz NOT NULL DEFAULT now(),
	last_seen timestamptz NOT NULL DEFAULT now(),
	removed_at timestamptz,
	meta jsonb,
	CONSTRAINT oz_entries_source_key UNIQUE (source, key)
);
CREATE INDEX IF NOT EXISTS oz_entries_key_idx ON oz_entries (key);
CREATE INDEX IF NOT EXISTS oz_entries_active_idx ON oz_entries (source) WHERE removed_at IS NULL;

-- Value flows observed on THORChain from a flagged address to another one.
CREATE TABLE IF NOT EXISTS oz_trace_edges (
	id bigserial PRIMARY KEY,
	txid text NOT NULL,
	from_key text NOT NULL,
	from_address text NOT NULL,
	from_chain text NOT NULL,
	to_key text NOT NULL,
	to_chain text NOT NULL,
	to_address text NOT NULL,
	action text NOT NULL,
	relation text NOT NULL,
	height bigint,
	ts timestamptz,
	amount text,
	usd numeric,
	hop integer NOT NULL,
	risk text NOT NULL,
	origin_key text NOT NULL,
	origin_source text NOT NULL,
	origin_entity text,
	origin_risk text NOT NULL,
	origin_category text NOT NULL,
	reason text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT oz_trace_edges_unique UNIQUE (txid, from_key, to_key)
);
CREATE INDEX IF NOT EXISTS oz_trace_edges_to_idx ON oz_trace_edges (to_key);
CREATE INDEX IF NOT EXISTS oz_trace_edges_from_idx ON oz_trace_edges (from_key);
CREATE INDEX IF NOT EXISTS oz_trace_edges_ts_idx ON oz_trace_edges (ts);

-- Addresses flagged by tracing (best/lowest-hop reason per address).
CREATE TABLE IF NOT EXISTS oz_traced (
	key text PRIMARY KEY,
	chain text NOT NULL,
	address text NOT NULL,
	hop integer NOT NULL,
	risk text NOT NULL,
	usd numeric,
	origin_key text NOT NULL,
	origin_source text NOT NULL,
	origin_entity text,
	origin_risk text NOT NULL,
	origin_category text NOT NULL,
	first_txid text NOT NULL,
	first_height bigint,
	first_ts timestamptz,
	edges integer NOT NULL DEFAULT 1,
	service boolean NOT NULL DEFAULT false,
	suppressed boolean NOT NULL DEFAULT false,
	updated_at timestamptz NOT NULL DEFAULT now()
);

-- Tracing progress: which addresses were checked on Midgard up to which height.
CREATE TABLE IF NOT EXISTS oz_trace_checked (
	key text PRIMARY KEY,
	checked_height bigint NOT NULL DEFAULT 0,
	checked_at timestamptz,
	actions integer NOT NULL DEFAULT 0,
	status text NOT NULL DEFAULT 'pending',
	error text
);

CREATE TABLE IF NOT EXISTS oz_state (
	id text PRIMARY KEY,
	value jsonb NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now()
);

-- Published snapshots (manifest signed; payload = gzip canonical JSON).
CREATE TABLE IF NOT EXISTS oz_snapshots (
	version bigint PRIMARY KEY,
	built_at timestamptz NOT NULL,
	sha256 text NOT NULL,
	size integer NOT NULL,
	manifest jsonb NOT NULL,
	payload bytea NOT NULL,
	stats jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

-- Reports (new address to list) and appeals (delisting / false positive).
-- No IP address, user agent or other request metadata is stored.
CREATE TABLE IF NOT EXISTS oz_submissions (
	id bigserial PRIMARY KEY,
	public_id text NOT NULL UNIQUE,
	kind text NOT NULL,
	address text NOT NULL,
	chain text,
	key text,
	message text NOT NULL,
	evidence text,
	contact text,
	status text NOT NULL DEFAULT 'open',
	resolution text,
	created_at timestamptz NOT NULL DEFAULT now(),
	resolved_at timestamptz,
	resolved_by text
);
CREATE INDEX IF NOT EXISTS oz_submissions_status_idx ON oz_submissions (status, created_at);

-- Maintainer overrides: an accepted appeal suppresses derived / community
-- reasons for an address (never an official sanctions listing).
CREATE TABLE IF NOT EXISTS oz_overrides (
	key text PRIMARY KEY,
	action text NOT NULL DEFAULT 'suppress',
	reason text NOT NULL,
	created_by text,
	created_at timestamptz NOT NULL DEFAULT now(),
	active boolean NOT NULL DEFAULT true
);

-- THORChain users: risk + structured detail next to the legacy flag columns.
ALTER TABLE rujira_users ADD COLUMN IF NOT EXISTS risk text;
ALTER TABLE rujira_users ADD COLUMN IF NOT EXISTS flag_detail jsonb;

-- Certificates: the server-computed verdict and its signature (the old
-- endpoint trusted a `flagged` value sent by the browser).
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS chain text;
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS risk text;
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS snapshot_version bigint;
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS document jsonb;
