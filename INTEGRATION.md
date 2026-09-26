# Integrating Ozone into a relayer node

Ozone publishes everything it knows as a **signed, versioned snapshot**. A
node verifies it against a pinned key and screens **locally** — no request
to Ozone at screening time, no address ever leaves the node, and an Ozone
outage only means "screen against the last verified snapshot" (the verdict
says how old it is). Ozone's online API stays available as an optional,
signed second opinion.

```
Ozone worker ──builds + signs──▶ /api/v1/snapshot (manifest)  ──▶ node: verify signature,
                                 /api/v1/snapshot/<version>   ──▶       hash, version ≥ current
                                 (any mirror can serve both)            → screen locally
```

## 1. Install the client

`packages/ozone-client` has no runtime dependencies (only `node:crypto`,
`node:zlib`, `node:fs`), works on Node ≥ 18 and ships CommonJS and ESM.

```bash
cd packages/ozone-client && npm run build && npm pack   # → redacted-ozone-client-1.0.0.tgz
# in the node repo:
npm install /path/to/redacted-ozone-client-1.0.0.tgz
```

(Or vendor `dist/cjs` — it is self-contained.)

## 2. Pin the keys

| Key | Signs | Where to get it |
|-----|-------|-----------------|
| snapshot key | snapshot manifests | Ozone operator (out of band) / `GET /api/v1/keys` (`usage: "snapshot"`) |
| response key | `/api/v1/screen` answers, certificates | same, `usage: "response"` |

Keys look like `ed25519:<base64 of the 32-byte public key>`; a key id is
`oz` + the first 16 hex characters of SHA-256(public key). **Pin them in
configuration** — never trust a key fetched at runtime without comparing it
to the pinned value. Rotation: Ozone publishes the new key next to the old
one; nodes add it to their list, then drop the old one.

## 3. Relayer node wiring (`src/v2/screening`)

`createOzoneSnapshotSource` implements the node's existing
`OzoneSnapshotSource` interface (`src/v2/screening/snapshot.ts`) exactly —
no change to `provider.ts` / `screener.ts` is needed:

```ts
import { createOzoneSnapshotSource } from '@redacted/ozone-client'

const snapshot = createOzoneSnapshotSource({
  trustedKeys: [process.env.V2_SCREENING_OZONE_SNAPSHOT_KEY!],        // pinned
  manifestUrls: [
    'https://ozone.redacted.gg/api/v1/snapshot',
    // mirrors, tried in order: another node, a static host, …
  ],
  cacheDir: '/var/lib/redacted-node/ozone',   // last verified snapshot survives restarts/outages
  refreshIntervalMs: 10 * 60_000,
  staleAfterMs: 24 * 60 * 60_000,
})
const provider = createOzoneProvider({ snapshot, online: createOzoneClient({ /* optional */ }) })
provider.start()   // → snapshot.start(): loads the verified disk cache, fetches now, then every 10 min
```

What the adapter returns:

| call | result |
|------|--------|
| `info()` | `{ version: '1790500000', createdAt: <build time ms>, sha256 }`, or `undefined` before the first verified snapshot |
| `lookup({address, chain})` | `{ status: 'flagged', reference: 'oz:v1790500000:flagged:OFAC_SDN,TRACE_SWAP' }` / `{ status: 'clean', reference: 'oz:v…:clean' }` |
| | `{ status: 'unsupported_chain' }` for a chain code Ozone cannot validate (ADA, DOT, SUI, TAO, …) **or an address that is not valid for that chain** — the node refuses (unscreenable), which is the safe answer |
| | throws `OzoneUnavailableError` if called with no snapshot loaded (the provider checks `info()` first) |
| `refresh()` | first call loads the verified disk cache; then fetches the newest manifest from the first mirror that answers, verifies it, downloads + verifies the payload if newer; rejects on failure while keeping the loaded snapshot |
| `start()` / `stop()` | immediate load (cache + network), then periodic refreshes (timer is `unref`'d) |

Chain codes are THORNode's (`THOR`, `BTC`, `ETH`, `BSC`, `BASE`, `AVAX`,
`GAIA`, `LTC`, `BCH`, `DOGE`, `TRON`, `XRP`, `SOL`, plus `ZEC`, `XMR`,
`DASH`, `BSV`, `BTG`, `ETC`, `ARB`, `OP`, `POL`, `BNB`). The node's
`normalizeAddress` output is accepted as is (BCH with or without
`bitcoincash:`, bech32 in either case, EVM in any case).

**Policy.** The adapter flags at risk `high` (Ozone's default). For the full
verdict — every reason with source, provenance link, dates and, for traces,
the THORChain transaction — use the client directly:

```ts
import { OzoneClient } from '@redacted/ozone-client'
const oz = new OzoneClient({ trustedKeys: [KEY], cacheDir, policy: { flagAt: 'high' } })
await oz.init(); oz.start()
const v = oz.screen(address, 'BTC')
// v.status: 'clean' | 'flagged' | 'invalid'; v.risk; v.reasons[]; v.reference
// v.snapshot: { version, builtAt, sha256, ageSeconds, stale }
```

Store `v.reference` (or the whole verdict) with the deposit attestation: it
names the snapshot version the decision rests on, and the snapshot itself is
signed, so anyone can re-derive the verdict later.

## 4. Snapshot format (for implementations in other languages)

**Manifest** (JSON, ≤ 256 KiB) — `format: "ozone.snapshot.manifest.v1"`:

```json
{
  "format": "ozone.snapshot.manifest.v1",
  "version": 1790500000,
  "builtAt": "2026-09-27T10:00:00.000Z",
  "payload": { "sha256": "<hex>", "size": 1234567, "encoding": "gzip", "url": "./snapshot/1790500000" },
  "counts": { "keys": 41000, "listed": 30000, "traced": 11000, "reasons": 45000 },
  "sources": [{ "id": "ofac_sdn", "entries": 1042, "lastSuccessAt": "…" }],
  "prev": { "version": 1790499400, "sha256": "<hex>" },
  "signature": { "alg": "ed25519", "keyId": "oz…", "sig": "<base64>" }
}
```

Verification:
1. the signed message is the UTF-8 bytes of
   `"ozone.snapshot.manifest.v1\n" + canonicalJson(manifest without "signature")`
   where canonical JSON = keys sorted by UTF-16 code units, no whitespace,
   `undefined` members dropped (RFC 8785 style); verify with the pinned
   Ed25519 key whose id equals `signature.keyId`;
2. download `payload.url` (relative to the manifest URL) — or, when the
   manifest lists `payload.parts` (large payloads; some hosts cap response
   sizes), every part in order, checking each part's size and SHA-256 — and
   check the total size and SHA-256 against the manifest;
3. refuse a `version` lower than the one you hold (rollback) and a different
   `sha256` for the same version (equivocation);
4. gunzip → JSON `format: "ozone.snapshot.v1"`, same `version`/`builtAt`.

**Payload**: `records` is `[key, reasons[]]` sorted by key; strings are
interned in `strings` and reasons reference them by index (`s` source index,
`c` code, `k` category, `r` risk rank 0–5 = none…severe, `t` text, `e`
entity, `n` chain, `u` ref URL, `i` ref id, `l` listed, `f` first seen, `x`
removed — unix seconds; `tr` trace: `h` hop, `a` action, `tx` txid, `fr`
from, `am` amount, `usd`, `ok` origin key, `os` origin source index).
A reason with `x` (removed) is history and never flags.

**Keys** are `<namespace>:<address>`: `evm:0x…` (lower-case, all EVM chains),
`btc:`/`ltc:`/`doge:` (base58 as is, bech32 lower-case), `bch:` cashaddr
without prefix, `tron:T…`, `xrp:r…`, `sol:…`, `thor:`/`gaia:` bech32. An
address without a chain hint is looked up under every valid reading
(`1…` → `btc`, `bch`, `bsv`). See `packages/ozone-client/src/chains.ts`.

## 5. Online API (optional)

`POST https://ozone.redacted.gg/api/v1/screen`
`{"addresses": ["0x…", {"address": "bc1…", "chain": "BTC"}], "policy": {"flagAt": "high"}}`
→ `ozone.screen.v1` body with one verdict per address, signed with the
response key (`"ozone.screen.response.v1\n" + canonicalJson(body without signature)`).
Verify with `verifyScreenResponse(body, [RESPONSE_KEY])` before trusting it.
Up to 100 addresses; nothing about the request is stored.

`GET /api/screen?address=…` (used by the node's current online client) keeps
its shape — `flagged: boolean`, `matches[].source`, now also `reference`
(`oz:v…:…`) and `attestation` (the signed v1 body). It answers 503 while
Ozone has no data (never "clean"), 400 for an invalid address.

`GET /api/health` — snapshot age, per-source sync state, real-time trace
cursor.

## 6. Mirrors

Any static host can serve a snapshot: `latest.json` (the manifest) next to a
`snapshot/<version>` file (and `snapshot/<version>.<n>` parts if the manifest
lists parts). Export one with
`npx tsx packages/ozone-engine/scripts/ozone.ts export <dir>`, or copy what
a node cached (`<cacheDir>/manifest.json`, `payload-<version>.json.gz`).
Authenticity comes from the signature, so nodes can mirror for each other.
