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

const SNAPSHOT_KEY = process.env.V2_SCREENING_OZONE_SNAPSHOT_KEY // `ed25519:<base64>`, pinned in config
if (!SNAPSHOT_KEY) throw new Error('V2_SCREENING_OZONE_SNAPSHOT_KEY is required')

export const ozoneSnapshot = createOzoneSnapshotSource({
  trustedKeys: [SNAPSHOT_KEY],
  manifestUrls: [
    'https://ozone.redacted.gg/api/v1/snapshot',
    // …mirrors (another node's export, a static bucket)
  ],
  cacheDir: process.env.V2_SCREENING_OZONE_CACHE_DIR ?? '/var/lib/redacted-node/ozone',
  refreshIntervalMs: 10 * 60_000,
  staleAfterMs: 24 * 60 * 60_000,
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
  const client = new OzoneClient({ trustedKeys: [SNAPSHOT_KEY!], cacheDir: '/var/lib/redacted-node/ozone' })
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
