/* tslint:disable */
/* eslint-disable */

/**
 * A phrase rotation in progress (E-12).
 */
export class PhraseRotationHandle {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Errata E-68 (13) R2-L4: the warning of a private move while notes a history file's holder can follow are
     * unspent (their fundings are refused: merge them first); `undefined` otherwise.
     */
    historyWarning(): string | undefined;
    steps(): string;
    /**
     * Take the new account's vault (once).
     */
    takeNewVault(): WasmVault;
    /**
     * Errata E-66 (5)(b), (8) (fix, view-key audit run-1 M4): the warning of a private move while a view key of this
     * account is out (where the moved value lands is linkable); `undefined` when none was exported.
     */
    viewKeyWarning(): string | undefined;
}

/**
 * The agent side (an agent process; never `S` or `d`).
 */
export class WasmAgent {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    agentReturn(coins_json: string, now: bigint): string;
    /**
     * Evaluate calls against the policy without signing: the new bucket state, or the refusal.
     */
    check(calls_json: string, relayer_fee_json: string | null | undefined, now: bigint): string;
    delegation(): string;
    execute(calls_json: string, fees_json: string, now: bigint): string;
    /**
     * A new agent key; returns the agent with an empty delegation (set it with `setDelegation`).
     */
    static generate(): WasmAgent;
    /**
     * The sealed key file and its passphrase are taken by value and wiped (review run-2 of findings 78/81).
     */
    static open(file: Uint8Array, passphrase: string): WasmAgent;
    pay(dest_id: string, denom: string, amt: string, fees_json: string, now: bigint): string;
    revokeSelf(now: bigint): string;
    /**
     * The sealed key file (`HOPSAGT1`), a `Uint8Array` copied from a wiped buffer (`secret_bytes`).
     */
    seal(passphrase: string): Uint8Array;
    /**
     * Set the delegation (JSON of `Delegation`), destinations by id (JSON object) and granted slots.
     */
    setDelegation(delegation_json: string, destinations_json: string, slots_json: string): void;
    /**
     * A THORChain swap whose output comes back to the account itself (D16: at most four memo fields, no
     * affiliate). `asset` JSON `{chain, symbol, ticker, secured}`; `min_out` a decimal string or null.
     */
    swapToSelf(denom: string, asset_json: string, amt: string, to_asset: string, min_out: string | null | undefined, fees_json: string, now: bigint): string;
    /**
     * The agent's public key (hex), for the owner's `delegate`.
     */
    vk(): string;
}

/**
 * Errata E-68 (4): a read-only history session, built from a history file and a deployment alone. It holds the file's
 * values and, after `verify`, its verdicts; every method reads. No method takes or returns a secret: the file holds
 * none (E-68 (2)), and nothing here prepares, signs, proves or builds a message.
 */
export class WasmHistorySession {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    accounts(): string;
    /**
     * The cut (`{height, block_hash}` JSON).
     */
    cut(): string;
    deploymentId(): string;
    exitAddresses(): string;
    fingerprint(): string;
    generations(): string;
    heldNullifiersIncluded(): boolean;
    items(): string;
    spendingAccounts(): string;
    status(): string;
    totals(): string;
    /**
     * Check every listed item against the chain at the cut: two sources' snapshots (`b_json` null: one) at or above
     * the cut, and the header hash of the block at the cut from each (`blocks_json`: a JSON list of one or two).
     */
    verify(a_json: string, b_json: string | null | undefined, blocks_json: string): void;
    warnings(): string;
}

/**
 * The opened vault (one unlock per session, E-4).
 */
export class WasmVault {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * A prepared deposit the wallet did not send (cancelled, refused to sign): its counter is free again
     * (errata E-32). `inner`: the plan's `request.inner`. Returns whether it was listed.
     */
    abandonDeposit(dep: string, inner: string): boolean;
    abandon(action_id: bigint): void;
    /**
     * A signed Spending call (E-4: never prompts by default; errata E-39: under an opted-in confirmation
     * policy a full-key call that moves value to a destination it covers throws `CONFIRMATION_REQUIRED`:
     * use `prepareCall`). `calls` JSON of `Call[]`, `fees` JSON of `CallFees`.
     */
    accountCall(dep: string, n: number, key: string, calls_json: string, fees_json: string, fee_auth_json: string | null | undefined, expiry: bigint): string;
    accountForTask(dep: string, task: string): string;
    /**
     * E-18: `{ kind: "phrase" }` or `{ kind: "wallet", scheme, origin, address, deployment_id, two_key }`.
     */
    accountKind(): string;
    /**
     * Errata E-70 (7): the creation of account `n` was refused `SafeKeyInUse`: retire it (the next allocation takes
     * the next index).
     */
    accountSquatted(dep: string, n: number): void;
    /**
     * The deployment's accounts (public data).
     */
    accounts(dep: string): string;
    /**
     * Errata E-68 (12) L-1, (13) Info 7: the owner acknowledges the exposure for the one message `action_json` names
     * (`HistoryAckAction`: `{"kind":"exit","notes":[…],"to":"home"}`, `{"kind":"lineage_audits"}`,
     * `{"kind":"veto_home","nf":…}`, `{"kind":"redirect_home","id":…}`); the notes exposed (JSON).
     */
    acknowledgeHistoryExposure(dep: string, action_json: string): string;
    agentSlots(dep: string, n: number, count: number): string;
    applyRestoredCounters(): void;
    /**
     * Errata E-68 (13) R2-L2: apply a state blob another device wrote (the node's `blob`, raw bytes): counters, the
     * address book, the published-opening mark, the history export records; only ever adds. Refused (`REPLAY`) below
     * the version floor. Returns its version.
     */
    applyStateBlob(dep: string, blob: Uint8Array): bigint;
    /**
     * Attach a deployment (JSON from `newDeployment`); returns its id (hex).
     */
    attach(deployment_json: string): string;
    /**
     * What the vault authorized (E-4: shown, not asked).
     */
    authorizations(): string;
    backupConfirmed(): boolean;
    /**
     * The encrypted backup file. `desktop` selects m = 256 MiB instead of the browser's 64 MiB. A `Uint8Array`
     * copied from a wiped buffer (`secret_bytes`).
     */
    backupFile(passphrase: string, desktop: boolean, include_d: boolean): Uint8Array;
    /**
     * Private balances `{ denom: "amount" }`.
     */
    balances(dep: string): string;
    beginGenerationRotation(dep: string, home: string | null | undefined, rescue: string | null | undefined, clear_rescue: boolean, new_device: boolean): number;
    beginPhraseRotation(dep: string): PhraseRotationHandle;
    /**
     * E-18b: upgrade a wallet-only account to the passkey level (a private re-note; the steps as a phrase
     * rotation, the new vault takes them up). Resumes an unfinished switch with the same passkey (sync
     * this vault first): no new header, only the notes still in the wallet-only generation move.
     */
    beginUpgradeToPasskey(dep: string, prf_hex: string): PhraseRotationHandle;
    /**
     * E-18: upgrade a wallet account to a phrase account (a private move; the steps as a phrase rotation).
     */
    beginUpgradeToPhrase(dep: string): PhraseRotationHandle;
    /**
     * Announce a withdrawal that goes out in parts (E-13: one card, one confirmation for all parts).
     * `parts` JSON `[[destination, amount], ...]`, `fee` JSON of `FeeTerms`. Each part is then prepared
     * with `prepareSpend` and options `{ ..., withdrawal: withdrawal_id }`.
     * Review RF-03 of the E-70 fixes: `timings_json` (optional) is one timing per part (`planPrivateExit`'s), kept in
     * the withdrawal's record (`withdrawals` lists them); a part to a fresh exit address needs one (`STATE`).
     */
    beginWithdrawal(dep: string, denom: string, parts_json: string, fee_json: string, expiry_height: bigint, timings_json?: string | null): string;
    cancelWithdrawal(withdrawal_id: bigint): void;
    /**
     * Errata E-28: would the proxy accept `calls` from the safe key? `rules` JSON: `[{contract, variant,
     * body?}]` (the proxy's registered close variants, expanded to contracts). Throws `POLICY_REFUSED:
     * SafeKeyNotAllowed: …` otherwise.
     */
    checkSafeClose(calls_json: string, relayer_fee_json: string | null | undefined, rules_json: string): void;
    config(): string;
    confirmBackupFile(file: Uint8Array, passphrase: string): void;
    /**
     * Errata E-72 review run-2 (R2-A, vault UI channel only): the person confirms that written header generation
     * `generation` on `dep`, which this session's own `d` binds, is theirs, opening the generation-choice gate.
     */
    confirmDeviceGeneration(dep: string, generation: number): void;
    /**
     * After the vault Worker verified a WebAuthn assertion (user verification) over `challenge`.
     */
    confirmPasskey(action_id: bigint, challenge_hex: string): void;
    /**
     * `answers`: JSON `[[position, "word"], …]` (words of the phrase: the text is wiped here, review run-2 of
     * findings 78/81; every word read from it in the core, `Session::confirm_phrase_words_json`, review run-3).
     */
    confirmPhraseWords(answers: string): boolean;
    confirmPin(action_id: bigint, pin: string): void;
    confirmationRequest(action_id: bigint): string | undefined;
    createAccountMsg(dep: string, n: number): string;
    /**
     * A new account: `S` and `d` from `crypto.getRandomValues` inside the Worker.
     */
    static create(config_json: string): WasmVault;
    /**
     * Owner side: delegate account `n` to an agent key (D15: a loosening).
     */
    delegate(dep: string, n: number, agent_vk: string, policy_json: string, delegation_expiry: bigint, can_return: boolean, now: bigint, expiry: bigint): string;
    /**
     * Errata E-72 review run-2 (R2-A, vault UI channel only): the written header generations for the vault UI's
     * generation choice after a pairing code, a device blob or the backup gave this session a `d` from outside
     * (`session` marks the one this device's `d` binds), with each height, its notes and amounts, and whether the
     * sync was cross-checked. Nothing is adopted.
     */
    deviceGenerations(dep: string): string;
    /**
     * This device's id in deployment `dep` (hex), or without it the id the session was opened with.
     */
    deviceId(dep?: string | null): number;
    /**
     * Errata E-61, the exit-address scan: `[ExitAddress…]` (JSON) up to `gap` indices past the last issued one.
     */
    exitAddresses(dep: string, gap: number): string;
    /**
     * Errata E-34: `to` ("home" or "rescue") pins the notes' exit destination; absent, no pin.
     */
    exitLock(dep: string, handles_json: string, to?: string | null): string;
    /**
     * Errata E-61, "Send home": a signed send of everything on one of this vault's exit addresses to home
     * (`SendHomeTx`, JSON: `tx_bytes` base64 for the platform to broadcast).
     */
    exitSendHome(dep: string, address: string, request_json: string): string;
    /**
     * C3: `expireReservation` for every input of a released action of this session, by its id.
     */
    expireAction(action_id: bigint, why: string): string;
    /**
     * C3: free the notes (JSON array of note handles) a released action holds after its relay failed,
     * for a re-proof (`Session::free_inputs`). `why`: `refused` (the node refused the relay: nothing was
     * submitted) or `expired` (only once a sync has passed the action's expiry height; a sync frees those
     * by itself too). Returns the freed handles' nullifiers (JSON hex array).
     */
    expireReservation(dep: string, handles_json: string, why: string): string;
    /**
     * The history file (`{file, fingerprint}` as JSON), exactly the one the last disclosure showed, only with its
     * fingerprint and while no sync happened since.
     */
    exportHistory(dep: string, fingerprint: string): string;
    /**
     * The sealed local state of a deployment for IndexedDB.
     */
    exportState(dep: string): Uint8Array;
    /**
     * The view-key file (`{file, fingerprint}` as JSON), only with the fingerprint its disclosure showed, at the
     * height that disclosure read (no sync since).
     */
    exportViewKey(dep: string, options_json: string, fingerprint: string): string;
    /**
     * Check the node's attestation and build the wallet's `deposit` message; the prepared deposit keeps
     * its counter until a sync is past the attestation's expiry (errata E-32).
     */
    finishDeposit(dep: string, plan_json: string, attestation_json: string, now: bigint, attest_vk?: string | null, registered_count?: number | null): string;
    /**
     * `by`: `full`, `safe` or `order:<id>`.
     */
    finishReturn(dep: string, plan_json: string, by: string, attestation_json: string | null | undefined, now: bigint, attest_vk?: string | null, registered_count?: number | null): string;
    freezeAgents(dep: string, n: number, key: string, expiry: bigint): string;
    freshExitAddress(dep: string): string;
    /**
     * Complete a pairing on the new device; `fetched_blob` is the node blob of an `id:` code. The code (it carries
     * the one-time pairing key) and the blob are taken by value and wiped.
     */
    static fromPairing(qr: string, fetched_blob: Uint8Array | null | undefined, config_json: string): WasmVault;
    /**
     * E-18, E-18a, E-18b: open a Strict wallet account (`adr036` or `eip191`) from a sign-in
     * (`with_sign_in`'s JSON: two equal answers, or one with the fingerprint the device kept). `level`:
     * `"passkey"` (recommended; `prf_hex` is the primary passkey's PRF output for `walletPasskeySalt`),
     * `"wallet"` (wallet only, `d = d_w`), or `"home-only"` (every passkey lost: home only). The sign-in text
     * is taken by value and wiped (review run-1 of findings 78/81).
     */
    static fromWallet(deployment_json: string, sign_in_json: string, level: string, prf_hex: string | null | undefined, config_json: string): WasmVault;
    hasDeviceFactor(): boolean;
    /**
     * The chain refused the reveal with `UnknownCommitment` (the commit is not on chain): `headerReport`
     * asks for the commit again.
     */
    headerCommitLost(dep: string): void;
    /**
     * C4: `header_commit` of the current generation. `NEEDS_SYNC` before the chain was read, `STATE`
     * when the chain shows the generation written (nothing to write). Remembers the view it was built on.
     */
    headerCommitMsg(dep: string): string;
    /**
     * The header commit was included at `height` (only after inclusion: the reveal needs it).
     */
    headerCommitted(dep: string, height: bigint): void;
    /**
     * The current generation's header plan (`{ generation, tau, values, salt, commitment }`), what its
     * commit and reveal carry; no check of the chain's view (`headerReport` says whether to write it).
     */
    headerPlan(dep: string): string;
    /**
     * C4: the current header generation and the next step (`{ generation, status, next, deposits_open,
     * reason, final_height }`, `next` one of `sync`, `commit`, `reveal`, `done`, `blocked`; `commit` until
     * `headerCommitted` named the height the commit landed at; `final_height` once written: from that
     * height no earlier commitment can replace the header, so the phrase alone recovers its deposits for
     * sure, errata E-32).
     */
    headerReport(dep: string): string;
    /**
     * C4: `header_reveal` of the current generation: after its commit and a sync newer than it
     * (`NEEDS_SYNC` otherwise), never over a number the chain gave another header.
     */
    headerRevealMsg(dep: string): string;
    /**
     * The disclosure of a history file with `options_json` (`HistoryOptions`; `"{}"`: the cut at the synced height,
     * held nullifiers left out), as JSON. It reads the chain first: `a_json` and `b_json` are two independent sources'
     * snapshots at one height (C5; `b_json` null: one source), `opts_json` the `SyncOptions` with the tip the platform
     * read (`min_height`, required), `blocks_json` the header hash (hex) of the block at the cut height from each
     * source the platform read it from (a JSON list of one or two). Errata E-68 (13) R2-L3: `activity_json` the listed
     * accounts' activity per source (`AccountActivity` list; absent: none read, so older action accounts stay live).
     */
    historyDisclosure(dep: string, options_json: string, a_json: string, b_json: string | null | undefined, opts_json: string, blocks_json: string, activity_json?: string | null): string;
    /**
     * The records of the history files exported for this account (fingerprint, cut, counts; never a file).
     */
    historyExports(dep: string): string;
    /**
     * Errata E-68 (12) L-1: the move-first path (`HistoryMovePlan` JSON: merges, singles, unknown files).
     */
    historyMovePlan(dep: string): string;
    /**
     * Errata E-68 (12) L-1: the history files out whose held notes are unspent, and those notes (`[fingerprints, notes]`).
     */
    historyNotesUnspent(dep: string): string;
    /**
     * Errata E-68 (13) R2-L6: the heights `[lo, hi]` (JSON) whose header hashes the platform reads for a cut at `cut`.
     */
    historyWindow(dep: string, cut: bigint): string;
    importState(deployment_json: string, blob: Uint8Array): string;
    lineageReport(dep: string): string;
    /**
     * Lock: drop every secret now (the handle is unusable afterwards).
     */
    lock(): void;
    markAudited(dep: string, indices_json: string): void;
    /**
     * Errata E-34: the queued payouts of this vault's spends (`MyQueueItem`s), from the last sync; pass 11b:
     * `authorized_here` (warn only when it and `to_own` are both false).
     */
    myQueueItems(dep: string): string;
    /**
     * A fresh Spending account; `scope` JSON of `AccountScope`, `policy` JSON or null.
     */
    newAccount(dep: string, scope_json: string, policy_json?: string | null, loosen_delay?: bigint | null): string;
    newDeviceFactor(): void;
    /**
     * Errata E-61: the scan found exit address `n` (keying `s`, `s_d` or `s_d_backup`) in use.
     */
    noteExitUsed(dep: string, n: number, keying: string): void;
    /**
     * Note handles: `[{ handle (cm hex), denom, amount, index, status, generation, this_device, superseded,
     * reserved, reachable, slow_request }]` (no `rho`). `superseded` (errata E-32): the note is under this
     * vault's own header values that an earlier commitment replaced on chain; the phrase alone does not
     * find it (`reachable` is false too): move it. `reserved`: the note is an input of an action in flight (prepared, or
     * relayed and not yet seen spent), so a spend cannot pick it. `this_device`: this device holds the
     * generation's `d`; without it the note pays home or rescue only (spec §3.6). `from_account` (errata E-67 (5),
     * only when set): a gift, returned from a Spending account this vault does not own (its address).
     */
    notes(dep: string): string;
    /**
     * A pairing code for a new device: JSON `{ qr_inline, qr_by_id, blob, blob_id, new_device_id }`
     * (`blob` base64, for the node blob store when the inline code is too large). Each code names the
     * next device id (§3.4).
     * Review run-2 of findings 78/81: both codes carry the one-time pairing key: the text crosses as `secret_json`
     * does (`PairingOffer`'s own `Serialize`, the same JSON); the TypeScript type stays `string`.
     */
    pairingOffer(): string;
    /**
     * Errata E-72 (1), review E72-1: every written header generation with whose passkey binds it (`file`,
     * `wallet_only`, `session`, `other`), its height, the unspent notes under it and their amounts, and whether the
     * sync was cross-checked: what the vault UI shows before the person names the generation that is theirs.
     */
    passkeyBackupGenerations(file: Uint8Array, passphrase: string): string;
    /**
     * E-18b: what this session's passkey is to the account (after a sync): `not_passkey`, `home_only`,
     * `fresh`, `matches`, `wallet_only_so_far` or `mismatch`.
     */
    passkeyCheck(dep: string): string;
    pendingActions(): string;
    phraseChallenge(): string;
    /**
     * The 25 words, for the vault's own display only. Review run-2 of findings 78/81: a JS string made from the
     * wiped words (`secret_text`); the TypeScript type stays `string`.
     */
    phrase(): string;
    /**
     * Plan a proof-free exit (E-9 audits first). `mode`: normal, alarm, bunker_k, bunker_p, rescue_build.
     * The plan always carries `pin` (pass 11b): send it and see it included before the reveal.
     * Errata E-66 (7d) fix: from then on the vault refuses a view-key export (the plan carries the owner opening).
     */
    planExit(dep: string, handles_json: string, to: string, chunk: number, reveal_ancestry: number, mode_str: string): string;
    /**
     * E-18b "bring everything home", the Spending accounts: `{ account_sweeps: [ExecuteMsg…], skipped }`
     * (a safe-key sweep home of each; relay each).
     */
    planHomeSweeps(dep: string, expiry_height: bigint): string;
    /**
     * E-18b "bring everything home", the notes: `{ spends: [SpendPlan…], skipped }` (one FAST withdrawal
     * home per note of `denom`, or of every denomination). Works with the wallet alone (no passkey): prove,
     * release and relay each.
     */
    planHomeWithdrawals(dep: string, denom: string | null | undefined, opts_json: string): string;
    planPrivateExit(dep: string, amt: string, max_parts: number, now: bigint, send_now: boolean): string;
    /**
     * Errata E-67 (2), review F3: for a lost or compromised home, every note of `denom` (or of every
     * denomination) moved to its generation's rescue with a FAST withdrawal (`home_only`): `{ spends:
     * [SpendPlan…], skipped }`. The default over the proof-free exit to rescue (rescue signs nothing, needs no
     * gas, no owner opening is published): prove, release and relay each (with `relayer: null`, the forced
     * lane, any sender once the notes' locks are `N_FORCED` blocks old).
     */
    planRescueWithdrawals(dep: string, denom: string | null | undefined, opts_json: string): string;
    /**
     * Errata E-39: prepare a Spending call (`CallPlan`: `call_id`, `card`, `needs_confirmation`); confirm it
     * like an action (`confirmationRequest`, `confirmPasskey`, `confirmPin`), then `releaseCall`; `abandon`
     * drops it. `quotes_json` (pass 11b): JSON of `SwapQuote[]` from the vault's own platform (never the
     * app's); under an opted-in policy a swap to self asks unless its limit is within the tolerance of one.
     */
    prepareCall(dep: string, n: number, key: string, calls_json: string, fees_json: string, fee_auth_json: string | null | undefined, expiry: bigint, quotes_json?: string | null): string;
    prepareDeposit(dep: string, depositor: string, denom: string, amt: string): string;
    /**
     * Errata E-62, "Move privately" step 2 for one old note (its commitment): a SLOW request `SpendPlan` (JSON).
     */
    prepareRestartMove(dep: string, cm: string, opts_json: string): string;
    prepareReturn(dep: string, n: number, coins_json: string, expiry: bigint): string;
    /**
     * Prepare a private action. `inputs`: JSON note handles; `kind`: JSON of `SpendKind`; `opts`: JSON of
     * `SpendOptions`. Returns the plan (card, flags, digests) without the witness.
     */
    prepareSpend(dep: string, inputs_json: string, amt: string, kind_json: string, opts_json: string): string;
    /**
     * The proof job (with the witness) for the vault's prover Worker only; the wasm-side text is wiped
     * (finding 78, `secret_json`).
     */
    proofJob(action_id: bigint): string;
    /**
     * Errata E-34: `queue_redirect_home` for one of `myQueueItems`' items (`item_json`: its `item`),
     * home of the spent notes' generation; in Bunker-K with the destination proof.
     */
    queueRedirectHome(dep: string, item_json: string, mode_str?: string | null): string;
    /**
     * Fresh randomness for a prepared action's proof (after `MESSAGE_TOO_LARGE`, or a re-proof).
     */
    refreshProof(action_id: bigint): void;
    refreshSlots(dep: string, n: number, expiry: bigint): string;
    /**
     * Errata E-39: sign a prepared call (`CONFIRMATION_REQUIRED` until confirmed when it needs it).
     */
    releaseCall(call_id: bigint): string;
    /**
     * Release a proven action (E-4: silent unless the owner opted into confirmations).
     */
    release(action_id: bigint, envelope: Uint8Array): string;
    /**
     * Errata E-69 (R4-E1): the text the HOME wallet signs to confirm `rescue` for this wallet account on `dep` ("Confirm
     * your rescue in your wallet": the rescue address shows in its signing window).
     */
    rescueBindingMessage(dep: string, rescue: string): string;
    /**
     * Errata E-69 (R3-E1): the text the rescue wallet signs to become this wallet account's rescue on `dep` ("Sign
     * with your rescue wallet"); `scheme` is the rescue wallet's (`adr036-secp256k1` or `eip191-secp256k1`).
     */
    rescueConsentMessage(dep: string, scheme: string, rescue: string): string;
    /**
     * Errata E-62, "Move privately" step 1: the move's own Spending account (`AccountState`, JSON).
     */
    restartMoveAccount(dep: string): string;
    /**
     * Errata E-62: the restart's state `RestartReport` (JSON).
     */
    restartReport(dep: string): string;
    /**
     * Errata E-62, "Send home" for the old notes: `{ spends: [SpendPlan…], skipped }` (prove, release, relay each).
     */
    restartSendHome(dep: string, denom: string | null | undefined, opts_json: string): string;
    /**
     * Errata E-62, "Restart with this passkey" (after a sync that shows `mismatch`): `RestartReport` (JSON).
     */
    restartWithThisPasskey(dep: string): string;
    static restoreFromBackup(file: Uint8Array, passphrase: string): WasmVault;
    /**
     * Review run-2 of findings 78/81: the phrase is taken by value and wiped, as every secret a binding below takes
     * (a passphrase, a PIN, a PRF output, a pairing code, a sealed blob or backup file).
     */
    static restoreFromPhrase(phrase: string, config_json: string): WasmVault;
    /**
     * Errata E-72 (1), review E72-1: after `other_generations`, adopt the file's `d` because header generation
     * `generation` on `dep` (which binds it, shown by a cross-checked sync) is the person's own.
     */
    restorePasskeyBackupAs(file: Uint8Array, passphrase: string, dep: string, generation: number): string;
    /**
     * Errata E-63: open a passkey backup of this wallet + passkey account; its `d` reaches the lost passkey's exit
     * addresses (`exit_addresses`; `own`: it is this session's own `d`). Errata E-72 (1): on a session opened with
     * the wallet alone whose synced deployment shows a written header binding the file's `d`, the `d` becomes the
     * session's (`session`: the full account).
     */
    restorePasskeyBackup(file: Uint8Array, passphrase: string): string;
    /**
     * The counters a backup file carried (JSON), to apply after attaching the deployments.
     */
    restoredCounters(): string;
    revokeDelegation(dep: string, n: number, delegation_id: number, key: string, expiry: bigint): string;
    rotationAdvice(dep: string): string;
    /**
     * E-12 step 3 for one note: fund a fresh account of `new_vault` with the whole note, or with one part of its
     * move (`amount`, errata E-70 (3): `MoveNote.parts`).
     */
    rotationMoveNote(new_vault: WasmVault, dep: string, handle: string, opts_json: string, amount?: string | null): string;
    scheduleLineageAudits(dep: string, mode_str: string, proactive: boolean, chunk: number): string;
    sealDevicePassphrase(passphrase: string): Uint8Array;
    sealDevicePrfAndPin(prf: Uint8Array, pin: string): Uint8Array;
    sealDevicePrf(prf: Uint8Array): Uint8Array;
    /**
     * Errata E-72 (3): seal this device's blob under the wallet's `S` and a passphrase (unlock kind 4): a wallet
     * account on a device without passkeys; `unsealDevice` on the wallet's own session opens it.
     */
    sealDeviceWallet(passphrase: string): Uint8Array;
    secondProofBody(action_id: bigint, envelope: Uint8Array): string;
    secondProofDone(action_id: bigint): void;
    /**
     * The second proof's job (E-15: FAST2 at 0x0204, the others at 0x02); fresh randomness per call.
     */
    secondProofJob(action_id: bigint): string;
    secondProofsDue(): string;
    /**
     * One or two input notes of one header generation covering `amt` (see `Session::select_inputs`);
     * `device_only` keeps to the generations this device holds `d` for (a third-party withdrawal, a
     * funding).
     * Errata E-68 (13) R2-L4: the inputs of a funding of a Spending account (`selectInputs` with the device's
     * generations only), skipping notes a history file's holder can follow (merge those first).
     */
    selectFundingInputs(dep: string, denom: string, amt: string): string;
    selectInputs(dep: string, denom: string, amt: string, device_only?: boolean | null): string;
    /**
     * E-4: `off` (default), `third_party` or `all_withdrawals`.
     */
    setConfirmPolicy(policy: string): void;
    /**
     * Change home and rescue (`undefined` or `""` clears the rescue) while the current header is only
     * planned; after that a new header generation does it (`beginGenerationRotation`, §3.7).
     */
    setDestinations(home: string, rescue?: string | null): void;
    /**
     * Pass 11b (E-34): give the home and rescue of an older header generation (a device restored with
     * another home; the sync warns while one that holds notes has none). They must hash to the
     * generation's `Hd` and `Rd` (`INVALID_ADDRESS` otherwise). A redirect home or a veto home of a payout
     * from that generation's notes needs them.
     */
    setGenerationDestinations(dep: string, generation: number, home: string, rescue?: string | null): void;
    /**
     * Errata E-69 (R3-E1, R4-E1): keep the rescue consent (JSON `{ scheme, address, public_key, signature,
     * home_public_key, home_signature }`, hex: the rescue wallet's and the home wallet's answers),
     * verified now; then set the rescue as usual (`setDestinations`, or a generation rotation after the header).
     */
    setRescueConsent(consent_json: string): void;
    standingOrder(dep: string, n: number, key: string, order_id: number, min_amounts_json: string, max_returns: number, order_expiry: bigint, expiry: bigint): string;
    /**
     * Errata E-68 (13) R2-L2: the version floor (the highest version this device applied or wrote; write floor + 1).
     */
    stateBlobFloor(dep: string): bigint;
    /**
     * Errata E-68 (13) R2-L2: the id of this account's state blob (`GET /blob/{id}`).
     */
    stateBlobId(dep: string): string;
    /**
     * Errata E-68 (13) R2-L2: a node took the blob of `version`: the floor rises to it.
     */
    stateBlobWritten(dep: string, version: bigint): void;
    /**
     * The node-mirrored state blob: JSON `{ id, token, blob }` for `PUT /blob/{id}`. Review run-2 of findings
     * 78/81: the write token crosses as `secret_json` does (`StateBlobUpload`, the same JSON); the TypeScript type
     * stays `string`.
     */
    stateBlob(dep: string, version: bigint): string;
    sweepHome(dep: string, n: number, key: string, to: string, dest_generation: number, expiry: bigint): string;
    /**
     * E-18b: where an account switch (wallet only → passkey) stands (after a sync): `{ applicable,
     * wallet_only_generations, passkey_generations, notes_left, value_left, unfinished, resumable_here }`.
     */
    switchState(dep: string): string;
    /**
     * Errata E-38 (C5): sync from two snapshots of independent sources at one height (they must be
     * equal); options as `syncWith`.
     */
    syncChecked(dep: string, a_json: string, b_json: string, opts_json: string): void;
    /**
     * Errata E-38: the last sync of this session `{ synced, height, sources, cross_checked }`.
     */
    syncStatus(dep: string): string;
    /**
     * `sync` with options (JSON `{ deep: bool }`): `deep` scans far beyond the spec's gaps, for a restore
     * that misses money; notes found beyond them are `reachable: false` in `notes()` and should move.
     */
    syncWith(dep: string, snapshot_json: string, opts_json: string): void;
    /**
     * Sync from a chain snapshot (bulk feeds at one height, JSON).
     */
    sync(dep: string, snapshot_json: string): void;
    /**
     * E-18a: the K-path keys of this phrase account on a K deployment: `{ owner_secret, scan_key,
     * account_id }` (hex; `account_id` base64). `S` stays in WebAssembly. Review run-2 of findings 78/81:
     * `owner_secret` and `scan_key` cross as `secret_json` does (as `transitionWalletKeys`' do); the TypeScript
     * type stays `string`.
     */
    transitionKeys(k_deployment_json: string): string;
    static unlockPassphrase(blob: Uint8Array, passphrase: string, config_json: string): WasmVault;
    static unlockPrfAndPin(blob: Uint8Array, prf: Uint8Array, pin: string, config_json: string): WasmVault;
    static unlockPrf(blob: Uint8Array, prf: Uint8Array, config_json: string): WasmVault;
    /**
     * Errata E-72 (3): open this device's kind-4 blob into this wallet + passkey session opened with the wallet alone
     * (`fromWallet` with `home-only`): the session is then the passkey session.
     */
    unsealDevice(blob: Uint8Array, passphrase: string): void;
    /**
     * Errata E-34: `mode` (normal, alarm, bunker_k, bunker_p, rescue_build; default normal) decides
     * whether a veto home carries the Bunker-K destination proof.
     */
    veto(dep: string, nf_hex: string, request_hex: string, home: boolean, expiry: bigint, mode_str?: string | null): string;
    /**
     * The disclosure of a view key with `options_json` (`ViewKeyOptions`; `"{}"` names everything), as JSON. It
     * reads the chain first (errata E-66 (fix)): `a_json` and `b_json` are two independent sources' snapshots at
     * one height (C5; `b_json` null: one source), `opts_json` the `SyncOptions` with the tip the platform read
     * (`min_height`, required).
     */
    viewKeyDisclosure(dep: string, options_json: string, a_json: string, b_json: string | null | undefined, opts_json: string): string;
    /**
     * The records of the view keys exported for this account (fingerprint, height, what each names).
     */
    viewKeyExports(dep: string): string;
    /**
     * E-18a: a wallet account's fingerprint (hex, non-secret): keep it to open the account later with one
     * signature.
     */
    walletFingerprint(): string;
    warnings(dep: string): string;
    /**
     * The open split withdrawals: `[{ withdrawal_id, card, released, confirmed_by, timings }]` (`timings`: one per
     * part, `null` for a part without one; review RF-03).
     */
    withdrawals(): string;
}

/**
 * Errata E-66 (4): a view-only session, built from a view-key file and a deployment alone. It holds the
 * file's values and public chain data; every method reads. No method takes or returns a secret: the
 * file holds none (E-66 (2)), and nothing here prepares, signs, proves or builds a message.
 */
export class WasmViewSession {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    accountActivity(): string;
    balances(): string;
    deploymentId(): string;
    exitAddresses(): string;
    fingerprint(): string;
    /**
     * The generation keys the view key names (JSON array).
     */
    generations(): string;
    history(): string;
    notes(): string;
    /**
     * Errata E-48 for the viewer (errata E-66 (fix)): the chain tip the platform read itself.
     */
    setMinHeight(height: bigint): void;
    /**
     * The listed Spending accounts (JSON `[[index, address]]`).
     */
    spendingAccounts(): string;
    /**
     * Errata E-66 (fix): a deep sync, cross-checked (C5).
     */
    syncCheckedDeep(a_json: string, b_json: string): void;
    /**
     * C5: two independent sources at one height, which must agree.
     */
    syncChecked(a_json: string, b_json: string): void;
    syncStatus(): string;
    syncWith(snapshot_json: string, deep: boolean): void;
    /**
     * Replay one source's bulk feeds (`ChainSnapshot` JSON).
     */
    sync(snapshot_json: string): void;
    warnings(): string;
}

/**
 * Check what WP-A's prover returned (`vkId`, `publicInputs`, `piDigest`, `envelope`) against the job and
 * return the envelope. The job text is taken by value and wiped (finding 78).
 */
export function acceptProverOutput(job_json: string, vk_id: number, public_inputs: Uint8Array, pi_digest: Uint8Array, envelope: Uint8Array): Uint8Array;

/**
 * The unauthenticated parameters of a backup file (to tell the user what it costs to open).
 */
export function backupHeader(file: Uint8Array): string;

/**
 * Unlock kind of a device blob without decrypting it: 1 PRF, 2 PIN or passphrase, 3 PRF and PIN. Review run-2 of
 * findings 78/81: a sealed secret (a device blob, a backup file) is taken by value and wiped, as its passphrase,
 * PIN or PRF output is (a `&[u8]` or `&str` argument is the glue's copy, freed unwiped).
 */
export function blobUnlockKind(blob: Uint8Array): number;

/**
 * The canonical form of an address under a prefix (throws otherwise).
 */
export function canonicalAddress(text: string, hrp: string): string;

/**
 * `pin`, `short`, `passphrase` or `empty` (the 6-digit PIN warning of 04 §3.4). The secret is taken by value and
 * wiped (review run-2 of findings 78/81).
 */
export function classifySecret(s: string): string;

export function coarseAmount(a: string, decimals: number, symbol: string): string;

/**
 * C5: two snapshots from independent sources must agree exactly at one height.
 */
export function crossCheckSnapshots(a_json: string, b_json: string): void;

/**
 * Errata E-70 (1): the expiry an exit part (its `timing` from `planPrivateExit`) proves with at height `now`;
 * `STATE` before the part's `submit_at`.
 */
export function exitPartExpiry(timing_json: string, now: bigint, max_expiry_delta: bigint): bigint;

export function exitSplit(a: string, max_parts: number): string;

export function exitTiming(now: bigint, max_expiry_delta: bigint, send_now: boolean): string;

/**
 * Errata E-68 (14) R3-J3: the heights `[lo, hi]` (JSON) a reader with the 32-byte `seed_hex` asks for a cut at `cut`
 * (a viewer keeps a random seed of its own per file).
 */
export function historyCutWindow(seed_hex: string, cut: bigint): string;

export function ladderCeil(a: string): string | undefined;

export function ladderFloor(a: string): string | undefined;

/**
 * The privacy linter for a public edge: `inflows` is JSON `[[height, "amount"], …]`.
 */
export function lintEdge(a: string, height: bigint, inflows: string, window: bigint): string;

/**
 * The local mock prover (localnet only): the §5.8 envelope over `SHA-256(public_inputs)`. The job text
 * is taken by value and wiped (finding 78).
 */
export function mockProve(job_json: string): Uint8Array;

/**
 * A deployment (JSON) from chain id, proxy and prefix, with the launch windows.
 */
export function newDeployment(chain_id: string, proxy: string, hrp: string, localnet_fast: boolean, account_code_checksum?: string | null): string;

/**
 * Errata E-68 (4): open a history file for a deployment (JSON, `newDeployment`). The file (the notes' openings) is
 * taken by value and wiped, and read without an unwiped copy (review run-3 of findings 78/81).
 */
export function openHistory(file: string, deployment_json: string): WasmHistorySession;

/**
 * Errata E-66 (4): open a view-key file for a deployment (JSON, `newDeployment`). The file (`rk`, `nk`, `ck`: the
 * account's whole history) is taken by value and wiped, and read without an unwiped copy (review run-3 of findings
 * 78/81: a `&str` argument is the glue's copy, freed unwiped).
 */
export function openViewKey(file: string, deployment_json: string): WasmViewSession;

/**
 * Check a typed phrase without opening anything (throws the phrase error codes). The text is taken by value and
 * wiped (review run-2 of findings 78/81: a `&str` argument is the glue's copy, freed unwiped).
 */
export function phraseCheck(text: string): void;

/**
 * WP-A's statement document (A-freeze1 §8) of a proof job, for its prover Worker (`{cmd: 'prove', doc,
 * profile}`). Secret: it carries the witness; it goes only to the prover Worker of the same origin. The
 * job text is taken by value and wiped with the job and the document (finding 78); the document crosses as
 * `secret_json` does.
 */
export function proverDocument(job_json: string): string;

/**
 * Exit timing (mean 6 h, node-held window, client hold beyond; `send_now` skips the delay).
 * The stored count of a registered attestation root from the proxy's `attest_root` response, with the
 * proxy's expiry rule (`expires ≥ now` and `attestation_expiry ≤ expires`).
 */
export function registeredCount(attest_root_json: string, attestation_expiry: bigint, now: bigint): number;

/**
 * Errata E-69 (R4-E1): the text the home wallet (`home_scheme`, `home`) of the wallet account with fingerprint
 * `account_hex` signs to confirm `rescue` on the deployment.
 */
export function rescueBindingMessage(deployment_json: string, account_hex: string, home_scheme: string, home: string, rescue: string): string;

/**
 * Errata E-69 (R3-E1): the text a rescue wallet signs to become the rescue of the wallet account with fingerprint
 * `account_hex` on the deployment (`scheme` the rescue wallet's: `adr036-secp256k1` or `eip191-secp256k1`).
 */
export function rescueConsentMessage(deployment_json: string, account_hex: string, scheme: string, rescue: string): string;

/**
 * Errata E-28: would the proxy admit a third-party return of `slots` under the per-denomination
 * ceilings? `liability`, `pending` and `ceiling` are JSON objects `{denom: amount string}` (the chain's
 * values; a denomination absent from `ceiling` is unbounded). Throws `POLICY_REFUSED: CeilingReached: …`.
 */
export function returnWithinCeiling(slots_json: string, liability_json: string, pending_json: string, ceiling_json: string): void;

/**
 * §9.2: does a withdrawal or funding of `amount` need a second proof at this `eff(V2)`?
 */
export function secondProofRequired(a: string, v2?: string | null): boolean;

/**
 * The start-up self-test (domain chaining values, SHA-256 KATs, hardware against software
 * compression). The vault refuses to start when it throws.
 */
export function selftest(): void;

/**
 * A `ChainSnapshot` (JSON) from the records of WP-E's bulk feeds read at one pinned height
 * (`FeedRecords` JSON: `{ height, notes, nullifiers, headers, accounts, slow, queue, deposits }`, each the
 * pages' `records` concatenated).
 */
export function snapshotFromFeeds(records_json: string): string;

/**
 * E-15: parts that need no second proof (JSON array of amounts).
 */
export function splitBelowSecondProof(a: string, v2: string, max_parts: number): string;

/**
 * E-18a: the K-path keys of a Transition (K contract) wallet account: `{ account_id, address, fingerprint,
 * owner_secret, scan_key }` (hex; `account_id` base64). `S_w` stays in WebAssembly. Review run-1 of findings
 * 78/81: `owner_secret` and `scan_key` cross as `secret_json` does (a `TransitionWalletKeys` written straight
 * into a wiped text, no `serde_json::Value` on the way, handed to JS as a `JsString`); the sign-in text is taken
 * by value and wiped. The JS type stays `string`.
 */
export function transitionWalletKeys(k_deployment_json: string, sign_in_json: string): string;

/**
 * The transaction size of a message (JSON of `ExecuteMsg`), to compare with 1,000,000 (E-15).
 */
export function txSize(msg_json: string): number;

/**
 * The crate version and spec.
 */
export function version(): string;

/**
 * Errata E-69: a wallet account's home, its wallet's canonical THORChain address under the deployment's prefix
 * (ADR-036 the signer's address; EIP-191 the THORChain form of the same 20 bytes, `address` `0x…` or that form).
 * `fromWallet` refuses settings with any other home (`WALLET_HOME`).
 */
export function walletHome(scheme: string, deployment_json: string, address: string): string;

/**
 * E-18a: the text the wallet signs for a wallet account of `scheme` (`adr036`, `eip191`,
 * `transition-adr036`, `transition-eip191`, with or without `-secp256k1`): it names the vault origin, the
 * deployment, the wallet and the scheme's version.
 */
export function walletMessage(scheme: string, origin: string, deployment_json: string, address: string): string;

/**
 * E-18b: the input the UI asks the primary passkey's PRF for (WebAuthn `prf.eval.first`, hex), from a
 * wallet sign-in: computed from `S_w` and the deployment, before `d` exists. The sign-in text (the wallet's
 * signatures, which `S_w` comes from) is taken by value and wiped (review run-1 of findings 78/81).
 */
export function walletPasskeySalt(deployment_json: string, sign_in_json: string): string;

/**
 * E-18: the ADR-036 sign document of a message (what `signArbitrary` signs).
 */
export function walletSignDoc(address: string, message: string): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly __wbg_phraserotationhandle_free: (a: number, b: number) => void;
    readonly __wbg_wasmagent_free: (a: number, b: number) => void;
    readonly __wbg_wasmhistorysession_free: (a: number, b: number) => void;
    readonly __wbg_wasmvault_free: (a: number, b: number) => void;
    readonly __wbg_wasmviewsession_free: (a: number, b: number) => void;
    readonly acceptProverOutput: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly backupHeader: (a: number, b: number, c: number) => void;
    readonly blobUnlockKind: (a: number, b: number, c: number) => void;
    readonly canonicalAddress: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly classifySecret: (a: number, b: number, c: number) => void;
    readonly coarseAmount: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly crossCheckSnapshots: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly exitPartExpiry: (a: number, b: number, c: number, d: bigint, e: bigint) => void;
    readonly exitSplit: (a: number, b: number, c: number, d: number) => void;
    readonly exitTiming: (a: number, b: bigint, c: bigint, d: number) => void;
    readonly historyCutWindow: (a: number, b: number, c: number, d: bigint) => void;
    readonly ladderCeil: (a: number, b: number, c: number) => void;
    readonly ladderFloor: (a: number, b: number, c: number) => void;
    readonly lintEdge: (a: number, b: number, c: number, d: bigint, e: number, f: number, g: bigint) => void;
    readonly mockProve: (a: number, b: number, c: number) => void;
    readonly newDeployment: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly openHistory: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly openViewKey: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly phraseCheck: (a: number, b: number, c: number) => void;
    readonly phraserotationhandle_historyWarning: (a: number, b: number) => void;
    readonly phraserotationhandle_steps: (a: number, b: number) => void;
    readonly phraserotationhandle_takeNewVault: (a: number, b: number) => void;
    readonly phraserotationhandle_viewKeyWarning: (a: number, b: number) => void;
    readonly proverDocument: (a: number, b: number, c: number) => void;
    readonly registeredCount: (a: number, b: number, c: number, d: bigint, e: bigint) => void;
    readonly rescueBindingMessage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly rescueConsentMessage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly returnWithinCeiling: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly secondProofRequired: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly selftest: (a: number) => void;
    readonly snapshotFromFeeds: (a: number, b: number, c: number) => void;
    readonly splitBelowSecondProof: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly transitionWalletKeys: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly txSize: (a: number, b: number, c: number) => void;
    readonly version: (a: number) => void;
    readonly walletHome: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly walletMessage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly walletPasskeySalt: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly walletSignDoc: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmagent_agentReturn: (a: number, b: number, c: number, d: number, e: bigint) => void;
    readonly wasmagent_check: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint) => void;
    readonly wasmagent_delegation: (a: number, b: number) => void;
    readonly wasmagent_execute: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint) => void;
    readonly wasmagent_generate: (a: number) => void;
    readonly wasmagent_open: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmagent_pay: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: bigint) => void;
    readonly wasmagent_revokeSelf: (a: number, b: number, c: bigint) => void;
    readonly wasmagent_seal: (a: number, b: number, c: number, d: number) => void;
    readonly wasmagent_setDelegation: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmagent_swapToSelf: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: bigint) => void;
    readonly wasmagent_vk: (a: number, b: number) => void;
    readonly wasmhistorysession_accounts: (a: number, b: number) => void;
    readonly wasmhistorysession_cut: (a: number, b: number) => void;
    readonly wasmhistorysession_deploymentId: (a: number, b: number) => void;
    readonly wasmhistorysession_exitAddresses: (a: number, b: number) => void;
    readonly wasmhistorysession_fingerprint: (a: number, b: number) => void;
    readonly wasmhistorysession_generations: (a: number, b: number) => void;
    readonly wasmhistorysession_heldNullifiersIncluded: (a: number) => number;
    readonly wasmhistorysession_items: (a: number, b: number) => void;
    readonly wasmhistorysession_spendingAccounts: (a: number, b: number) => void;
    readonly wasmhistorysession_status: (a: number, b: number) => void;
    readonly wasmhistorysession_totals: (a: number, b: number) => void;
    readonly wasmhistorysession_verify: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmhistorysession_warnings: (a: number, b: number) => void;
    readonly wasmvault_abandon: (a: number, b: number, c: bigint) => void;
    readonly wasmvault_abandonDeposit: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmvault_accountCall: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: bigint) => void;
    readonly wasmvault_accountForTask: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmvault_accountKind: (a: number, b: number) => void;
    readonly wasmvault_accountSquatted: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmvault_accounts: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_acknowledgeHistoryExposure: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmvault_agentSlots: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmvault_applyRestoredCounters: (a: number) => void;
    readonly wasmvault_applyStateBlob: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmvault_attach: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_authorizations: (a: number, b: number) => void;
    readonly wasmvault_backupConfirmed: (a: number) => number;
    readonly wasmvault_backupFile: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmvault_balances: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_beginGenerationRotation: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly wasmvault_beginPhraseRotation: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_beginUpgradeToPasskey: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmvault_beginUpgradeToPhrase: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_beginWithdrawal: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: bigint, l: number, m: number) => void;
    readonly wasmvault_cancelWithdrawal: (a: number, b: number, c: bigint) => void;
    readonly wasmvault_checkSafeClose: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmvault_config: (a: number, b: number) => void;
    readonly wasmvault_confirmBackupFile: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmvault_confirmDeviceGeneration: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmvault_confirmPasskey: (a: number, b: number, c: bigint, d: number, e: number) => void;
    readonly wasmvault_confirmPhraseWords: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_confirmPin: (a: number, b: number, c: bigint, d: number, e: number) => void;
    readonly wasmvault_confirmationRequest: (a: number, b: number, c: bigint) => void;
    readonly wasmvault_create: (a: number, b: number, c: number) => void;
    readonly wasmvault_createAccountMsg: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmvault_delegate: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: bigint, k: number, l: bigint, m: bigint) => void;
    readonly wasmvault_deviceGenerations: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_deviceId: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_exitAddresses: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmvault_exitLock: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmvault_exitSendHome: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmvault_expireAction: (a: number, b: number, c: bigint, d: number, e: number) => void;
    readonly wasmvault_expireReservation: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmvault_exportHistory: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmvault_exportState: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_exportViewKey: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmvault_finishDeposit: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: bigint, j: number, k: number, l: number) => void;
    readonly wasmvault_finishReturn: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: bigint, l: number, m: number, n: number) => void;
    readonly wasmvault_freezeAgents: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: bigint) => void;
    readonly wasmvault_freshExitAddress: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_fromPairing: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wasmvault_fromWallet: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly wasmvault_hasDeviceFactor: (a: number) => number;
    readonly wasmvault_headerCommitLost: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_headerCommitMsg: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_headerCommitted: (a: number, b: number, c: number, d: number, e: bigint) => void;
    readonly wasmvault_headerPlan: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_headerReport: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_headerRevealMsg: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_historyDisclosure: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number) => void;
    readonly wasmvault_historyExports: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_historyMovePlan: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_historyNotesUnspent: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_historyWindow: (a: number, b: number, c: number, d: number, e: bigint) => void;
    readonly wasmvault_importState: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmvault_lineageReport: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_lock: (a: number) => void;
    readonly wasmvault_markAudited: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmvault_myQueueItems: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_newAccount: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: bigint) => void;
    readonly wasmvault_newDeviceFactor: (a: number, b: number) => void;
    readonly wasmvault_noteExitUsed: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wasmvault_notes: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_pairingOffer: (a: number, b: number) => void;
    readonly wasmvault_passkeyBackupGenerations: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmvault_passkeyCheck: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_pendingActions: (a: number, b: number) => void;
    readonly wasmvault_phrase: (a: number, b: number) => void;
    readonly wasmvault_phraseChallenge: (a: number, b: number) => void;
    readonly wasmvault_planExit: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
    readonly wasmvault_planHomeSweeps: (a: number, b: number, c: number, d: number, e: bigint) => void;
    readonly wasmvault_planHomeWithdrawals: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmvault_planPrivateExit: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: bigint, i: number) => void;
    readonly wasmvault_planRescueWithdrawals: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmvault_prepareCall: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: bigint, o: number, p: number) => void;
    readonly wasmvault_prepareDeposit: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly wasmvault_prepareRestartMove: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmvault_prepareReturn: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: bigint) => void;
    readonly wasmvault_prepareSpend: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
    readonly wasmvault_proofJob: (a: number, b: number, c: bigint) => void;
    readonly wasmvault_queueRedirectHome: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmvault_refreshProof: (a: number, b: number, c: bigint) => void;
    readonly wasmvault_refreshSlots: (a: number, b: number, c: number, d: number, e: number, f: bigint) => void;
    readonly wasmvault_release: (a: number, b: number, c: bigint, d: number, e: number) => void;
    readonly wasmvault_releaseCall: (a: number, b: number, c: bigint) => void;
    readonly wasmvault_rescueBindingMessage: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmvault_rescueConsentMessage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmvault_restartMoveAccount: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_restartReport: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_restartSendHome: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmvault_restartWithThisPasskey: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_restoreFromBackup: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmvault_restoreFromPhrase: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmvault_restorePasskeyBackup: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmvault_restorePasskeyBackupAs: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly wasmvault_restoredCounters: (a: number, b: number) => void;
    readonly wasmvault_revokeDelegation: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: bigint) => void;
    readonly wasmvault_rotationAdvice: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_rotationMoveNote: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly wasmvault_scheduleLineageAudits: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmvault_sealDevicePassphrase: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_sealDevicePrf: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_sealDevicePrfAndPin: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmvault_sealDeviceWallet: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_secondProofBody: (a: number, b: number, c: bigint, d: number, e: number) => void;
    readonly wasmvault_secondProofDone: (a: number, b: bigint) => void;
    readonly wasmvault_secondProofJob: (a: number, b: number, c: bigint) => void;
    readonly wasmvault_secondProofsDue: (a: number, b: number) => void;
    readonly wasmvault_selectFundingInputs: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmvault_selectInputs: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly wasmvault_setConfirmPolicy: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_setDestinations: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmvault_setGenerationDestinations: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly wasmvault_setRescueConsent: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_standingOrder: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: bigint, m: bigint) => void;
    readonly wasmvault_stateBlob: (a: number, b: number, c: number, d: number, e: bigint) => void;
    readonly wasmvault_stateBlobFloor: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_stateBlobId: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_stateBlobWritten: (a: number, b: number, c: number, d: number, e: bigint) => void;
    readonly wasmvault_sweepHome: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: bigint) => void;
    readonly wasmvault_switchState: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_sync: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmvault_syncChecked: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly wasmvault_syncStatus: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_syncWith: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmvault_transitionKeys: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_unlockPassphrase: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wasmvault_unlockPrf: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wasmvault_unlockPrfAndPin: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly wasmvault_unsealDevice: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmvault_veto: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: bigint, k: number, l: number) => void;
    readonly wasmvault_viewKeyDisclosure: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
    readonly wasmvault_viewKeyExports: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_walletFingerprint: (a: number, b: number) => void;
    readonly wasmvault_warnings: (a: number, b: number, c: number, d: number) => void;
    readonly wasmvault_withdrawals: (a: number, b: number) => void;
    readonly wasmviewsession_accountActivity: (a: number, b: number) => void;
    readonly wasmviewsession_balances: (a: number, b: number) => void;
    readonly wasmviewsession_deploymentId: (a: number, b: number) => void;
    readonly wasmviewsession_exitAddresses: (a: number, b: number) => void;
    readonly wasmviewsession_fingerprint: (a: number, b: number) => void;
    readonly wasmviewsession_generations: (a: number, b: number) => void;
    readonly wasmviewsession_history: (a: number, b: number) => void;
    readonly wasmviewsession_notes: (a: number, b: number) => void;
    readonly wasmviewsession_setMinHeight: (a: number, b: bigint) => void;
    readonly wasmviewsession_spendingAccounts: (a: number, b: number) => void;
    readonly wasmviewsession_sync: (a: number, b: number, c: number, d: number) => void;
    readonly wasmviewsession_syncChecked: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmviewsession_syncCheckedDeep: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmviewsession_syncStatus: (a: number, b: number) => void;
    readonly wasmviewsession_syncWith: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmviewsession_warnings: (a: number, b: number) => void;
    readonly memory: WebAssembly.Memory;
    readonly __wbindgen_export: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput, memory?: WebAssembly.Memory }} module - Passing `SyncInitInput` directly is deprecated.
 * @param {WebAssembly.Memory} memory - Deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput, memory?: WebAssembly.Memory } | SyncInitInput, memory?: WebAssembly.Memory): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory }} module_or_path - Passing `InitInput` directly is deprecated.
 * @param {WebAssembly.Memory} memory - Deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory } | InitInput | Promise<InitInput>, memory?: WebAssembly.Memory): Promise<InitOutput>;
