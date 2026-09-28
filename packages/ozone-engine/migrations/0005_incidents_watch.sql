-- Pass E: cluster expansion for every incident, and the watcher for new hack
-- money arriving at THORChain.
--
-- oz_cluster_members: every cluster's members, per cluster, so one incident
-- can be re-expanded (or pasted through the incident path) without touching
-- the others; the `cluster` source is the union of the clusters still defined.
-- oz_cluster_runs: the last run of each cluster (complete or cut short, with
-- the frontier the next run resumes from and what was skipped).
-- oz_watch_queue: large THORChain inbounds from L1 addresses waiting for (or
-- done with) a look-back at their funders; oz_l1_funders caches an address's
-- funders so a look-back is never repeated within its lifetime.
--
-- Additive and idempotent: safe to re-run and to apply while the current app
-- and worker keep running. The seed below copies today's active cluster
-- entries (the Bybit cluster) into oz_cluster_members once, so the first
-- union built from the new table does not delist them.

CREATE TABLE IF NOT EXISTS oz_cluster_members (
	cluster text NOT NULL,
	incident text NOT NULL,
	key text NOT NULL,
	chain text NOT NULL,
	address text NOT NULL,
	depth integer NOT NULL,
	from_address text,
	value double precision,
	tx text,
	ts timestamptz,
	found_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (cluster, key)
);
CREATE INDEX IF NOT EXISTS oz_cluster_members_key_idx ON oz_cluster_members (key);

INSERT INTO oz_cluster_members (cluster, incident, key, chain, address, depth, from_address, value, tx, ts)
SELECT meta->>'cluster', meta->>'cluster', key, chain, address, COALESCE((meta->>'depth')::int, 1), meta->>'from',
	(meta->>'valueEth')::double precision, ref_id, listed_at
FROM oz_entries
WHERE source = 'cluster' AND removed_at IS NULL AND meta->>'cluster' IS NOT NULL AND meta->>'incident' IS NULL
ON CONFLICT (cluster, key) DO NOTHING;

CREATE TABLE IF NOT EXISTS oz_cluster_runs (
	cluster text PRIMARY KEY,
	incident text NOT NULL,
	chain text NOT NULL,
	ran_at timestamptz NOT NULL,
	complete boolean NOT NULL,
	params_hash text NOT NULL,
	window_from timestamptz,
	window_to timestamptz,
	requests integer NOT NULL DEFAULT 0,
	members integer NOT NULL DEFAULT 0,
	services integer NOT NULL DEFAULT 0,
	stop text,
	seeds jsonb,
	service_list jsonb,
	frontier jsonb,
	skipped jsonb,
	error text
);

CREATE TABLE IF NOT EXISTS oz_watch_queue (
	key text PRIMARY KEY,
	chain text NOT NULL,
	address text NOT NULL,
	txid text,
	height bigint,
	ts timestamptz,
	usd double precision,
	asset text,
	action text,
	status text NOT NULL DEFAULT 'pending',
	reason text,
	attempts integer NOT NULL DEFAULT 0,
	result jsonb,
	enqueued_at timestamptz NOT NULL DEFAULT now(),
	checked_at timestamptz
);
CREATE INDEX IF NOT EXISTS oz_watch_queue_status_idx ON oz_watch_queue (status, enqueued_at);

CREATE TABLE IF NOT EXISTS oz_l1_funders (
	key text PRIMARY KEY,
	chain text NOT NULL,
	checked_at timestamptz NOT NULL,
	funders jsonb NOT NULL
);
