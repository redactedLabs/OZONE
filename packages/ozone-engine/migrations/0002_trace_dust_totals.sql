-- Running per-(origin, recipient, hop) USD totals for value flows *under*
-- the dust threshold. Those flows never get their own oz_trace_edges row
-- (they flag nothing on their own), but many of them from the same origin to
-- the same recipient must still add up when the snapshot decides whether a
-- recipient crossed the "full" USD threshold for that hop. Additive: safe to
-- apply to the live database while the current app and worker keep running.

CREATE TABLE IF NOT EXISTS oz_trace_dust_totals (
	origin_key text NOT NULL,
	to_key text NOT NULL,
	hop integer NOT NULL,
	usd numeric NOT NULL DEFAULT 0,
	updated_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (origin_key, to_key, hop)
);
