# OZONE

**Compliance screening for THORChain & Rujira**

Ozone aggregates sanctions lists, hack databases, on-chain blacklists, and community-curated sources to screen wallet addresses across the Rujira ecosystem. Fully open source — transparent screening that the community can verify and contribute to.

[Live App](https://ozone.redacted.gg) &middot; [Report an Address](https://github.com/redactedLabs/OZONE/issues/new?template=report-address.yml) &middot; [Open Source Info](https://ozone.redacted.gg/open-source)

---

## Architecture

```
Public sources (no API keys)            OZONE-WORKER (long-running)               OZONE (this repo, Vercel)
────────────────────────────            ───────────────────────────               ─────────────────────────
OFAC SDN · UK FCDO · EU FSF ──┐         list sync (sanity-checked, delistings)     /api/v1/screen   signed verdicts
FBI / IC3 · curated         ──┤         Ethereum hack-cluster expansion            /api/v1/snapshot signed snapshots
Chainalysis oracle events   ──┼──────▶  THORChain flow tracing                ──▶  /api/v1/keys     public keys
Tether · Circle freeze events ┤          (Midgard backfill + real time)            /api/health
eth-labels · ScamSniffer    ──┘         signed snapshot every 10 min               methodology · reports · appeals
Midgard (THORChain history) ─────────▶  THORChain user screening                   dashboard (Svelte)
                                              │
                                              └──▶ relayer nodes download the snapshot, verify, screen locally
```

The engine (`packages/ozone-engine`) and the node client (`packages/ozone-client`)
are plain TypeScript packages: the app imports them, the worker vendors them.
See [INTEGRATION.md](INTEGRATION.md) for node integration and the snapshot format,
and the [methodology page](https://ozone.redacted.gg/methodology) for how verdicts are made.

### Data Sources

| Source | Kind | What is imported |
|--------|------|------------------|
| **OFAC SDN** | Government | every "Digital Currency Address" identifier, all tickers; delistings tracked |
| **UK Sanctions List (FCDO)** | Government | wallet addresses in designation texts (checksum-validated) |
| **EU consolidated list** | Government | wallet addresses in entity remarks, listing regulation as provenance |
| **FBI / IC3** | Law enforcement | DPRK (TraderTraitor/Lazarus) laundering addresses, e.g. the Bybit PSA |
| **Chainalysis sanctions oracle** | On-chain | add/remove events (no API key), e.g. the Tornado Cash delisting |
| **Tether / Circle** | On-chain | USDT freezes (ETH, TRON, AVAX), USDC blacklist (ETH, BASE, AVAX), incl. unfreezes |
| **Hack clusters** | Derived | Ethereum fan-out of attributed hack addresses inside the laundering window (Bybit) |
| **eth-labels / ScamSniffer** | Community | exploiter, heist and phishing labels; drainer addresses |
| **Curated / maintainers** | Curated | verified attributions with a named primary source; maintainer flags |
| **THORChain tracing** | Derived | recipients of value from listed addresses through THORChain, with the tx as evidence |

## Stack

- **Frontend**: SvelteKit 5, Tailwind CSS 4, Three.js (globe visualization)
- **Backend**: SvelteKit API routes, Drizzle ORM (+ plain SQL in the engine)
- **Database**: PostgreSQL
- **Auth**: Better-Auth (IP tracking disabled)
- **Tests**: Vitest, PGlite (embedded Postgres) — `pnpm test`

## Getting Started

```bash
# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Edit .env with your database URL and API keys

# Push database schema
pnpm db:push

# Start dev server
pnpm dev
```

### Environment Variables

See `.env.example` for the full list. Required:

- `DATABASE_URL` — PostgreSQL connection string
- `BETTER_AUTH_SECRET` — Session encryption key
- `BETTER_AUTH_URL` — App URL (e.g., `http://localhost:5173`)

Optional:
- `OZONE_API_SIGNING_KEY` — Ed25519 seed that signs API answers and certificates
- `OZONE_SNAPSHOT_PUBLIC_KEYS` — the worker's snapshot key(s), published at `/api/v1/keys`
- `OZONE_SYNC_IN_APP=1` — run list sync in the app's cron (only without the worker)
- `OZONE_SNAPSHOT_SIGNING_KEY` — only if the app itself publishes snapshots
- `CRON_SECRET` — Protects sync endpoints
- `MIDGARD_URL` — THORChain Midgard endpoint

Engine locally (embedded Postgres, never a remote DB):

```bash
npx tsx packages/ozone-engine/scripts/ozone.ts sync        # all lists
npx tsx packages/ozone-engine/scripts/ozone.ts cluster     # hack-cluster expansion
npx tsx packages/ozone-engine/scripts/ozone.ts trace --minutes 30
npx tsx packages/ozone-engine/scripts/ozone.ts snapshot && npx tsx packages/ozone-engine/scripts/ozone.ts stats
npx tsx packages/ozone-engine/scripts/evaluate.ts          # quality gates + coverage before/after
npx tsx packages/ozone-engine/scripts/serve-db.ts          # serve it on 127.0.0.1:54329 for `pnpm dev`
```

## Database Schema

Both OZONE and [OZONE-WORKER](https://github.com/redactedLabs/OZONE-WORKER) share a single PostgreSQL database. Schema is managed via Drizzle ORM (`src/lib/server/db/schema.ts`); the Ozone tables (`oz_*`) are defined by the idempotent, additive migration `packages/ozone-engine/migrations/0001_ozone_next.sql` (apply with `psql -f`, or `OZONE_AUTO_MIGRATE=1` in the worker). `compliance_entries` is legacy (written by the pre-2.0 worker only).

### Core tables

```
compliance_entries        Sanctions & blacklist data (OFAC, EU, Tether, ScamSniffer, etc.)
├── address               Wallet address
├── chain                 Blockchain network
├── source                Which list (ofac, eu, tether, scamsniffer, eth-labels, hacks)
├── entity_name           Name of sanctioned entity (if available)
├── reason                Why it's flagged
├── added_at / last_seen  Timestamps

rujira_users              THORChain / Rujira users discovered via Midgard & WebSocket
├── thor_address          THORChain address (unique)
├── first_seen / last_seen
├── screened_at           Last time addresses were screened
├── l1_fetched_at         Last time L1 addresses were discovered
├── flagged               Whether any L1 address matched a compliance list
└── flag_reason           Which source triggered the flag

l1_addresses              L1 chain addresses linked to THORChain users
├── thor_address          Parent THORChain address
├── l1_address            BTC, ETH, SOL, etc. address
├── chain                 Which chain
├── pool                  LP pool (if discovered via pool membership)
└── unique(thor_address, l1_address, chain)

transactions              THORChain transactions observed via WebSocket
├── tx_hash               Transaction hash (unique)
├── block_height
├── memo / memo_type      THORChain memo (SWAP, ADD, WITHDRAW, RUJIRA, OTHER)
├── from_address / to_address
├── asset / amount / chain
└── processed             Whether screener has checked this TX

certificates              Proof of Innocence certificates
├── cert_id               Public certificate ID
├── address               Screened address
├── flagged               Result
├── sources_checked       Number of sources checked
└── issued_at

reports                   Shareable transaction history reports
├── report_id             Public report ID
├── address               Wallet (hidden unless reveal_wallet = true)
├── date_from / date_to   Date range
├── include_new           Live mode: include new TXs after creation
├── reveal_wallet         Show address in shared view
├── tx_count / tx_data    Cached transactions (JSON)
└── created_at

manual_flags              Admin-added flagged addresses
├── address / chain
├── reason
├── added_by              Admin who added it
└── active                Soft delete

sync_log                  Sync job history (for monitoring)
├── type                  Which sync (ofac, eu, tether, scamsniffer, etc.)
├── status                success / error
├── records_processed / flags_found
├── error / duration
└── created_at
```

## Contributing

We welcome contributions from the community:

- **Report addresses**: Use the [Report Address](https://github.com/redactedLabs/OZONE/issues/new?template=report-address.yml) issue template
- **Report false positives**: Open an issue if an address is incorrectly flagged
- **New data sources**: Submit a PR to add new compliance data integrations
- **Bug fixes & improvements**: PRs welcome

See the companion worker repo: [OZONE-WORKER](https://github.com/redactedLabs/OZONE-WORKER)

## License

Open source. See [open-source page](https://ozone.redacted.gg/open-source) for details.
