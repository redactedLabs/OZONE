-- The tables the current OZONE app already has in production (from
-- src/lib/server/db/schema.ts). Only applied to local/test databases so the
-- engine can run against an embedded Postgres; never needed in production.

CREATE TABLE IF NOT EXISTS compliance_entries (
	id serial PRIMARY KEY,
	address text NOT NULL,
	chain text,
	source text NOT NULL,
	entity_name text,
	reason text,
	added_at timestamp DEFAULT now(),
	last_seen timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS compliance_addr_source_unique ON compliance_entries (address, source);

CREATE TABLE IF NOT EXISTS rujira_users (
	id serial PRIMARY KEY,
	thor_address text NOT NULL UNIQUE,
	first_seen timestamp DEFAULT now(),
	last_seen timestamp DEFAULT now(),
	screened_at timestamp,
	l1_fetched_at timestamp,
	flagged boolean DEFAULT false,
	flag_reason text
);

CREATE TABLE IF NOT EXISTS l1_addresses (
	id serial PRIMARY KEY,
	thor_address text NOT NULL,
	l1_address text NOT NULL,
	chain text NOT NULL,
	pool text,
	affiliate boolean DEFAULT false,
	discovered_at timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS l1_addr_unique ON l1_addresses (thor_address, l1_address, chain);

CREATE TABLE IF NOT EXISTS sync_log (
	id serial PRIMARY KEY,
	type text NOT NULL,
	status text NOT NULL,
	records_processed integer,
	flags_found integer,
	error text,
	duration integer,
	created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS manual_flags (
	id serial PRIMARY KEY,
	address text NOT NULL,
	chain text,
	reason text NOT NULL,
	added_by text,
	added_at timestamp DEFAULT now(),
	active boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS certificates (
	id serial PRIMARY KEY,
	cert_id text NOT NULL UNIQUE,
	address text NOT NULL,
	flagged boolean DEFAULT false,
	sources_checked integer DEFAULT 8,
	issued_at timestamp DEFAULT now()
);
