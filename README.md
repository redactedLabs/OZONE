# OZONE

**Compliance screening for THORChain & Rujira**

Ozone aggregates sanctions lists, hack databases, on-chain blacklists, and community-curated sources to screen wallet addresses across the Rujira ecosystem. Fully open source — transparent screening that the community can verify and contribute to.

[Live App](https://ozone.redacted.gg) &middot; [Report an Address](https://github.com/redactedLabs/OZONE/issues/new?template=report-address.yml) &middot; [Open Source Info](https://ozone.redacted.gg/open-source)

---

## Architecture

```
Data Sources                    OZONE (this repo)              OZONE-WORKER
─────────────                   ──────────────────             ─────────────
OFAC SDN List ──┐                                              WebSocket listener
EU Sanctions ───┤               SvelteKit Frontend             (real-time THORChain TXs)
Tether Frozen ──┤  ──ingest──>  + API Routes         <──db──>
ScamSniffer ────┤               + Auth (Better-Auth)           Cron-based list syncing
Eth Labels ─────┤               + PostgreSQL (Drizzle)         (OFAC, EU, Tether, etc.)
Chainalysis ────┤               + Three.js Globe
Known Hacks ────┤
Midgard ────────┘

Flow: Ingest → Map L1 addresses → Screen → Flag
```

### Data Sources

| Source | Type | Description |
|--------|------|-------------|
| **OFAC SDN List** | Government | US Treasury Specially Designated Nationals |
| **EU Sanctions** | Government | EU Consolidated Financial Sanctions List |
| **Tether Frozen** | On-chain | USDT blacklisted addresses (ETH + TRON events) |
| **ScamSniffer** | Community | Phishing and scam address database |
| **Eth Labels** | Community | 170k+ labeled EVM addresses |
| **Chainalysis** | Commercial | Sanctions screening oracle API |
| **Known Hacks** | Curated | Bybit, Ronin, Nomad, Harmony, WazirX, KuCoin |
| **Midgard** | Infrastructure | THORChain indexer for user & address discovery |

## Stack

- **Frontend**: SvelteKit 5, Tailwind CSS 4, Three.js (globe visualization)
- **Backend**: SvelteKit API routes, Drizzle ORM
- **Database**: PostgreSQL
- **Auth**: Better-Auth
- **Deployment**: Vercel

## Features

- Real-time wallet screening against 8+ compliance sources
- L1 address discovery — links THORChain addresses to BTC, ETH, SOL, etc.
- Proof of Innocence certificates
- Transaction history analysis
- Public screening API
- Interactive 3D globe showing flagged address distribution
- Admin dashboard for compliance list management

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
- `CHAINALYSIS_API_KEY` — Chainalysis sanctions oracle
- `CRON_SECRET` — Protects sync endpoints
- `MIDGARD_URL` — THORChain Midgard endpoint

## Database Schema

Both OZONE and [OZONE-WORKER](https://github.com/redactedLabs/OZONE-WORKER) share a single PostgreSQL database. Schema is managed via Drizzle ORM (`src/lib/server/db/schema.ts`). Run `pnpm db:push` to apply.

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
