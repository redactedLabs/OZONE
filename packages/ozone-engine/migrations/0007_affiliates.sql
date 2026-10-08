-- Pass G: affiliate fee collectors (interface infrastructure), learned from
-- Midgard: outputs Midgard marks as an affiliate fee, the THORNames swappers
-- name as their affiliate, and a classification of traced thor1 accounts by
-- their own history. An affiliate collector is shared infrastructure: a
-- THORName link through it is not evidence of common ownership, and it never
-- passes taint on (trace/flows.ts, store/affiliates.ts).
--
-- Additive and idempotent: safe to re-run and to apply while the current app
-- and worker keep running.

CREATE TABLE IF NOT EXISTS oz_affiliates (
	address text PRIMARY KEY,
	-- swaps the real-time follower saw paying it an affiliate fee
	receipts integer NOT NULL DEFAULT 0,
	names text[] NOT NULL DEFAULT '{}',
	-- classification by its own history: actions read, of which affiliate fees received
	actions_read integer,
	affiliate_actions integer,
	first_height bigint,
	last_height bigint,
	checked_at timestamptz,
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oz_affiliate_names (
	name text PRIMARY KEY,
	uses integer NOT NULL DEFAULT 0,
	updated_at timestamptz NOT NULL DEFAULT now()
);
