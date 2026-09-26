# @redacted/ozone-client

Verify Ozone's signed compliance snapshots and screen addresses **locally**
— for relayer nodes and anyone who must not send the addresses they screen
to a third party.

- Address parsing and normalisation for every THORChain chain (THOR, BTC,
  ETH, BSC, BASE, AVAX, GAIA, LTC, BCH, DOGE, TRON, XRP, SOL) and the extra
  chains sanctions lists use; checksums always verified.
- Snapshot verification: Ed25519 over canonical JSON, payload SHA-256,
  anti-rollback, equivocation detection, size limits.
- `OzoneClient`: mirrors, on-disk cache of the last verified snapshot,
  periodic refresh, `screen()` returning the full verdict (risk, reasons,
  provenance, snapshot version and age).
- `createOzoneSnapshotSource()`: drop-in for the relayer node's
  `OzoneSnapshotSource` interface.
- `verifyScreenResponse()`: check signed answers of the online API.
- `buildSnapshot()`: build and sign snapshots (used by Ozone's worker).

No runtime dependencies; Node ≥ 18; ESM and CommonJS builds (`npm run build`).

See [INTEGRATION.md](../../INTEGRATION.md) for the node wiring and the format.
