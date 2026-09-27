/**
 * Example: wiring Ozone's node-local screening into the relayer node
 * (redacted relayer-node, src/v2/screening). Not part of the package build.
 *
 * The node's provider (provider.ts) already takes an `OzoneSnapshotSource`;
 * `createOzoneSnapshotSource` implements that interface exactly.
 */
import { createOzoneSnapshotSource, OzoneClient } from '@redacted/ozone-client'
// in the node: import { createOzoneProvider } from './provider'
//              import { createOzoneClient } from './ozone'

// The node's configuration (src/v2/nodeConfig.ts): pinned `ed25519:<base64>` keys and manifest URLs
const SNAPSHOT_SIGNERS = (process.env.V2_SCREENING_SNAPSHOT_SIGNERS ?? '').split(',').filter(Boolean)
const SNAPSHOT_URLS = (process.env.V2_SCREENING_SNAPSHOT_URL ?? 'https://ozone.redacted.gg/api/v1/snapshot').split(',').filter(Boolean)
if (!SNAPSHOT_SIGNERS.length) throw new Error('V2_SCREENING_SNAPSHOT_SIGNERS (the pinned Ozone snapshot keys) is required')

export const ozoneSnapshot = createOzoneSnapshotSource({
  trustedKeys: SNAPSHOT_SIGNERS,
  manifestUrls: SNAPSHOT_URLS, // Ozone first, then mirrors (another node's export, a static bucket)
  cacheDir: `${process.env.V2_SCREENING_STATE_DIR ?? '/var/lib/redacted-v2/screening'}/ozone-snapshot`,
  refreshIntervalMs: 10 * 60_000,
  staleAfterMs: 24 * 60 * 60_000,
  // A restarted node must never load a very old mirror copy (or a stale
  // on-disk cache) and treat it as current. 7 days is the client's own
  // default — set explicitly here so the choice is visible; pass Infinity
  // instead to accept any age (never leave this unset to mean that).
  rejectOlderThanMs: 7 * 24 * 60 * 60_000,
  // observability without addresses
  onEvent: (e) => console.info(`[ozone] ${e.type}`, 'version' in e ? e.version : '', 'code' in e ? e.code : ''),
})

// const provider = createOzoneProvider({ snapshot: ozoneSnapshot, online: createOzoneClient({ timeoutMs: 4_000 }) })
// provider.start()   // loads the verified cache, fetches, refreshes every 10 min

/**
 * Full verdicts (reasons with provenance, trace evidence) for the
 * attestation record — same snapshot, same pinned key.
 */
export async function explain(address: string, chain: string) {
  const client = new OzoneClient({
    trustedKeys: SNAPSHOT_SIGNERS,
    manifestUrls: SNAPSHOT_URLS,
    cacheDir: `${process.env.V2_SCREENING_STATE_DIR ?? '/var/lib/redacted-v2/screening'}/ozone-snapshot`,
  })
  await client.init()
  const v = client.screen(address, chain)
  return {
    status: v.status, // 'clean' | 'flagged' | 'invalid'
    risk: v.risk,
    reference: v.reference, // oz:v<version>:<status>:<codes>
    snapshot: v.snapshot, // version, sha256, ageSeconds, stale
    reasons: v.reasons.map((r) => ({ source: r.source, text: r.text, ref: r.ref, txid: r.trace?.txid })),
  }
}
