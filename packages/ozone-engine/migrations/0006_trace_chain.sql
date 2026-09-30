-- Pass F: CosmWasm flows from the chain's transaction events.
--
-- oz_trace_chain_checked: which flagged thor1 accounts had their contract
-- transactions read (THORNode transaction search, trace/chain.ts), up to which
-- height. Separate from oz_trace_checked (the Midgard history), so reading
-- one source again never repeats the other. The real-time chain follower's
-- cursor is the oz_state row `trace:chain`.
--
-- Additive and idempotent: safe to re-run and to apply while the current app
-- and worker keep running.

CREATE TABLE IF NOT EXISTS oz_trace_chain_checked (
	key text PRIMARY KEY,
	checked_height bigint NOT NULL DEFAULT 0,
	checked_at timestamptz,
	txs integer NOT NULL DEFAULT 0,
	status text NOT NULL DEFAULT 'pending',
	error text
);
