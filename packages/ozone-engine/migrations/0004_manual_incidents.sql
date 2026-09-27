-- Incident path for maintainer flags ("a hack was announced: list these
-- addresses now"). One optional row per manual_flags row with what the
-- maintainer pasted besides the address: the incident name, the source URL
-- and a note, and until when the flag is urgent — while it is, the worker
-- lists it immediately, traces it (and whatever it reaches) before anything
-- else and publishes a snapshot right away instead of at the next tick.
--
-- A separate table instead of new manual_flags columns: manual_flags belongs
-- to the app's schema (Drizzle), and an app deployed before this migration
-- runs must keep working — it simply finds no row here.
--
-- Additive and idempotent: safe to re-run, and to apply to the live database
-- while the current app and worker keep running.

CREATE TABLE IF NOT EXISTS oz_manual_meta (
	flag_id integer PRIMARY KEY,
	incident text,
	ref_url text,
	note text,
	urgent_until timestamptz,
	created_by text,
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oz_manual_meta_urgent_idx ON oz_manual_meta (urgent_until);
