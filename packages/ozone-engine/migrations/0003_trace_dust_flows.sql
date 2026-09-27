-- One row per value flow that was under the dust threshold on its own,
-- keyed exactly like oz_trace_edges (txid, from_key, to_key). Replaying the
-- same THORChain action (backfill re-reads, retries, overlapping cursors,
-- the real-time follower and the backfill both seeing it, restarts) finds
-- the existing row and adds nothing: per-(origin, recipient, hop) totals are
-- SUMs over these rows, never a counter that is incremented.
--
-- Supersedes oz_trace_dust_totals (0002), whose running total was added to
-- again on every replay of the same action. That table is no longer read or
-- written; it stays only because migrations here are additive.
--
-- Additive and idempotent: safe to re-run, and to apply to the live database
-- while the current app and worker keep running.

CREATE TABLE IF NOT EXISTS oz_trace_dust_flows (
	txid text NOT NULL,
	from_key text NOT NULL,
	from_address text NOT NULL,
	from_chain text NOT NULL,
	to_key text NOT NULL,
	to_chain text NOT NULL,
	to_address text NOT NULL,
	action text NOT NULL,
	height bigint,
	ts timestamptz,
	amount text,
	usd numeric NOT NULL,
	hop integer NOT NULL,
	origin_key text NOT NULL,
	origin_source text NOT NULL,
	origin_entity text,
	origin_risk text NOT NULL,
	origin_category text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (txid, from_key, to_key)
);
CREATE INDEX IF NOT EXISTS oz_trace_dust_flows_group_idx ON oz_trace_dust_flows (origin_key, to_key, hop);
CREATE INDEX IF NOT EXISTS oz_trace_dust_flows_to_idx ON oz_trace_dust_flows (to_key);
