# OZONE

**Compliance screening for THORChain & Rujira**

Ozone aggregates sanctions lists, hack databases, on-chain blacklists, and community-curated sources to screen wallet addresses across the Rujira ecosystem. Fully open source — transparent screening that the community can verify and contribute to.

[Live App](https://ozone.redacted.gg) &middot; [Methodology](https://ozone.redacted.gg/methodology) &middot; [Report / Appeal](https://ozone.redacted.gg/submit) &middot; [Open Source Info](https://ozone.redacted.gg/open-source)

---

## Architecture

```
Public sources (no API keys)            OZONE-WORKER (long-running)               OZONE (this repo, Vercel)
────────────────────────────            ───────────────────────────               ─────────────────────────
OFAC SDN · UK FCDO · EU FSF ──┐         list sync (sanity-checked, delistings)     /api/v1/screen   signed verdicts
FBI / IC3 · hack incidents  ──┤         hack-cluster expansion (EVM, BTC, LTC)     /api/v1/snapshot signed snapshots
Chainalysis oracle events   ──┼──────▶  THORChain flow tracing                ──▶  /api/v1/keys     public keys
Tether · Circle freeze events ┤          (Midgard backfill + real time)            /api/health
eth-labels · ScamSniffer    ──┘         signed snapshot every 10 min               methodology · reports · appeals
Midgard (THORChain history) ─────────▶  THORChain inbound watcher (L1 funders)     dashboard (Svelte)
Explorers (routescan, Esplora) ──────▶  THORChain user screening
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
| **Chainalysis sanctions oracle** | On-chain | add/remove events (no API key) on Ethereum, Arbitrum, Optimism, Polygon, Avalanche and Base, e.g. the Tornado Cash delisting |
| **Tether / USDT0 / Circle** | On-chain | USDT freezes (ETH, TRON, AVAX), USDT0 freezes (Arbitrum, Polygon), USDC blacklist (ETH, BASE, AVAX, Arbitrum, Optimism, Polygon), incl. unfreezes |
| **Hack incidents** | Curated | 59 thefts and exploits (2019–2026, 233 addresses), each address with the public page that names it and a confidence: law enforcement, sanctions or the victim → risk severe; established investigators → risk high. Returned-funds incidents are kept as history. [Dataset](packages/ozone-engine/src/sources/curated-data.ts) |
| **Hack clusters** | Derived | per incident and chain (Ethereum and EVM chains, Bitcoin, Litecoin): fan-out of its attacker addresses inside the laundering window, above a value threshold, stopping at services, contracts, contract calls, CoinJoins and THORChain deposits |
| **eth-labels / ScamSniffer** | Community | exploiter, heist and phishing labels; drainer addresses |
| **Maintainers** | Curated | maintainer flags, incl. the incident path for freshly announced hacks |
| **Chainabuse** (optional) | Community | moderator-verified scam reports, risk medium; only with `CHAINABUSE_API_KEY` (free account, 10 calls/month) |
| **THORChain tracing** | Derived | recipients of value from listed addresses through THORChain, with the tx as evidence |

### Freshly announced hacks (incident path)

No public list carries a new hacker's addresses on day one. In the admin UI
(**Compliance Lists → + Hack / incident**, or `POST /api/admin/flags` with
`{addresses, incident, refUrl, note}`), a maintainer pastes them with the
public source. They become maintainer flags marked urgent for 48 h
(`oz_manual_meta`, migration `0004`). The worker checks the flags every 15 s:
on a change it lists them, reads their THORChain history — and that of every
recipient it finds, hop after hop — before anything else, and publishes a
signed snapshot right away, typically within minutes.

### Hack incidents, clusters and new hack money arriving at THORChain

- `packages/ozone-engine/src/sources/curated-data.ts` holds the incident
  dataset (`CURATED.incidents`, validated at every sync: checksums, EIP-55,
  one https source per address, role and confidence) and what was researched
  without a usable address list (`CURATED.searched`). To delist an address,
  keep it with `delisted: {date, reason}`; removing an incident delists it.
- Every incident is expanded on its own chains (`cluster/`): due clusters run
  in the worker every 6 h (open laundering windows weekly, closed ones once,
  cut-short runs resume where they stopped), within a request budget per
  cluster and per run; pasted maintainer incidents immediately. Explorers:
  routescan (Ethereum, Avalanche; keyless), public Esplora servers (Bitcoin,
  Litecoin), Blockscout instances (other EVM chains; about 10 keyless
  requests an hour), and optionally `ETHERSCAN_API_KEY` / `BLOCKSCOUT_API_KEY`.
  The expansion leaves the last 1,500 requests of a host's daily quota to the
  inbound watcher, so a large run never starves the look-backs.
- The worker's real-time follower queues every THORChain inbound of at least
  $25,000 (`OZONE_WATCH_MIN_USD`) from an unflagged L1 address; a separate job
  looks back one and two hops at its funders (`trace/watcher.ts`). A listed or
  traced funder makes the depositor traced (`TRACE_L1_FUNDING`), and its
  THORChain outputs are traced as usual.

### Tracing coverage

The backfill reads each flagged address's Midgard history oldest first and to
the end (Midgard's `fromHeight` returns the *oldest* page; the reader pages
forward with `prevPageToken`), continuing long histories over several slices.
Order: incident keys, then by risk; within a risk level traced addresses, then
attributions, then bulk lists, then same-key twins. The real-time follower
reads forward from its cursor and catches up after an outage instead of
skipping ahead (it no longer sends every address back to the backfill).

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
  (`npx tsx packages/ozone-engine/scripts/ozone.ts keygen <file>` writes a new seed to `<file>` and prints only the public key)
- `OZONE_SNAPSHOT_PUBLIC_KEYS` — the worker's snapshot key(s), published at `/api/v1/keys`
- `OZONE_SYNC_IN_APP=1` — run list sync in the app's cron (only without the worker)
- `OZONE_SNAPSHOT_SIGNING_KEY` — only if the app itself publishes snapshots
- `CRON_SECRET` — Protects sync endpoints
- `MIDGARD_URL` — THORChain Midgard endpoint

Engine locally (embedded Postgres, never a remote DB):

```bash
npx tsx packages/ozone-engine/scripts/ozone.ts sync        # all lists
npx tsx packages/ozone-engine/scripts/ozone.ts incidents   # the incident dataset (validation, counts)
npx tsx packages/ozone-engine/scripts/ozone.ts cluster     # hack-cluster expansion (due clusters; --force, --only)
npx tsx packages/ozone-engine/scripts/ozone.ts watch       # one pass over the inbound look-back queue
npx tsx packages/ozone-engine/scripts/incidents-eval.ts    # per incident: listed, cluster, traced (public data)
npx tsx packages/ozone-engine/scripts/ozone.ts trace --minutes 30
npx tsx packages/ozone-engine/scripts/ozone.ts snapshot && npx tsx packages/ozone-engine/scripts/ozone.ts stats
npx tsx packages/ozone-engine/scripts/evaluate.ts          # quality gates + coverage before/after
npx tsx packages/ozone-engine/scripts/serve-db.ts          # serve it on 127.0.0.1:54329 for `pnpm dev`
```

## Database Schema

Both OZONE and [OZONE-WORKER](https://github.com/redactedLabs/OZONE-WORKER) share a single PostgreSQL database. Schema is managed via Drizzle ORM (`src/lib/server/db/schema.ts`); the Ozone tables (`oz_*`) are defined by the idempotent, additive migrations `packages/ozone-engine/migrations/0001_ozone_next.sql` … `0005_incidents_watch.sql` (apply in order with `psql -f`, or `OZONE_AUTO_MIGRATE=1` in the worker). `compliance_entries` is legacy (written by the pre-2.0 worker only).

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

- **Report addresses / appeal a flag**: use [ozone.redacted.gg/submit](https://ozone.redacted.gg/submit) (maintainers review every submission; the status page shows the outcome) or the [Report Address](https://github.com/redactedLabs/OZONE/issues/new?template=report-address.yml) issue template
- **New data sources**: Submit a PR to add new compliance data integrations
- **Bug fixes & improvements**: PRs welcome

See the companion worker repo: [OZONE-WORKER](https://github.com/redactedLabs/OZONE-WORKER)

## License

Open source. See [open-source page](https://ozone.redacted.gg/open-source) for details.
