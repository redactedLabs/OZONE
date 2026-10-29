import type { AttestRootInfo, AuthorizationRecord, Call, CallFees, CloseRule, SlotEntry, ChainMode, ChainSnapshot, Coin, ConfirmPolicy, ConfirmRequest, Deployment, DepositPlan, Destination, ExecuteMsg, AccountKind, ExitPlan, FeedRecords, TransitionKeys, WalletSchemeName, WalletSignIn, WalletLevelName, PasskeyCheck, RestartReport, HeaderReport, SwitchState, SyncOptions, SyncStatus, CallPlan, SwapQuote, MyQueueItem, QueueFeedRecord, FreeInputs, Hex32, FeeTerms, FinishedDeposit, KeyKind, NodeAttestation, NoteView, Policy, ProofJob, ReviewCard, SpendKind, SpendOptions, SpendPlan, VaultConfig, WithdrawalPlan, ExitKeying, ViewKeyOptions, ViewKeyDisclosure, ViewKeyExport, ViewKeyExportRecord, HistoryOptions, HistoryDisclosure, HistoryExport, HistoryExportRecord, HistoryMovePlan, HistoryAckAction, AccountActivity, RescueConsent, PasskeyRestore, PasskeyBackupGeneration } from "./types.js";
/** The wasm-bindgen module (generated `wasm/vault_core.js`). */
export interface WasmModule {
    initSync(arg: {
        module: BufferSource | WebAssembly.Module;
    }): unknown;
    default?(arg?: unknown): Promise<unknown>;
    version(): string;
    selftest(): void;
    phraseCheck(text: string): void;
    classifySecret(s: string): string;
    canonicalAddress(text: string, hrp: string): string;
    newDeployment(chainId: string, proxy: string, hrp: string, localnetFast: boolean, checksum?: string | null): string;
    blobUnlockKind(blob: Uint8Array): number;
    backupHeader(file: Uint8Array): string;
    ladderFloor(a: string): string | undefined;
    ladderCeil(a: string): string | undefined;
    exitSplit(a: string, maxParts: number): string;
    coarseAmount(a: string, decimals: number, symbol: string): string;
    lintEdge(a: string, height: bigint, inflows: string, window: bigint): string;
    exitTiming(now: bigint, maxExpiryDelta: bigint, sendNow: boolean): string;
    exitPartExpiry(timingJson: string, now: bigint, maxExpiryDelta: bigint): bigint;
    registeredCount(attestRootJson: string, attestationExpiry: bigint, now: bigint): number;
    walletMessage(scheme: string, origin: string, deploymentJson: string, address: string): string;
    walletHome(scheme: string, deploymentJson: string, address: string): string;
    rescueConsentMessage(deploymentJson: string, accountHex: string, scheme: string, rescue: string): string;
    rescueBindingMessage(deploymentJson: string, accountHex: string, homeScheme: string, home: string, rescue: string): string;
    walletSignDoc(address: string, message: string): Uint8Array;
    transitionWalletKeys(kDeploymentJson: string, signInJson: string): string;
    walletPasskeySalt(deploymentJson: string, signInJson: string): string;
    snapshotFromFeeds(recordsJson: string): string;
    txSize(msgJson: string): number;
    proverDocument(jobJson: string): string;
    acceptProverOutput(jobJson: string, vkId: number, publicInputs: Uint8Array, piDigest: Uint8Array, envelope: Uint8Array): Uint8Array;
    secondProofRequired(amount: string, v2?: string | null): boolean;
    splitBelowSecondProof(amount: string, v2: string, maxParts: number): string;
    crossCheckSnapshots(a: string, b: string): void;
    returnWithinCeiling(slotsJson: string, liabilityJson: string, pendingJson: string, ceilingJson: string): void;
    mockProve(job: string): Uint8Array;
    /** Errata E-66 (4): a view-only session from a view-key file and a deployment (JSON). */
    openViewKey(file: string, deploymentJson: string): any;
    /** Errata E-68 (4): a read-only history session from a history file and a deployment (JSON). */
    openHistory(file: string, deploymentJson: string): any;
    /** Test builds only (`wasm-test/`): every secret of an account a test chose (hex list). */
    viewKeySecretsForTests?(sHex: string, dHex: string, deploymentJson: string): string;
    WasmVault: any;
    WasmAgent: any;
    WasmSim?: any;
}
/** An error from vault-core: `code` is stable (e.g. `PHRASE_CHECKSUM`, `CONFIRMATION_REQUIRED`). */
/** Errata E-70 (1): an exit part's timing (`planPrivateExit`, `util.exitTiming`). */
export type ExitTiming = {
    send_now: boolean;
    submit_at: number;
    node_hold_blocks: number;
    expiry_offset: number;
    expiry_height: number;
};
export declare class VaultError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare function asVaultError(e: unknown): VaultError;
/** Errata E-66 (1), E-68 (1): the largest view-key and history texts the parsers read (the SDK refuses longer ones before the module copies them, E-68 (12) I-2). */
export declare const VIEW_KEY_MAX_BYTES: number;
export declare const HISTORY_MAX_BYTES: number;
/**
 * Errata E-68 (13) R2-I2: whether `text` is longer than `max` bytes of UTF-8, counted without copying (a JS string
 * counts UTF-16 code units: up to three bytes each). Stops counting once past `max`.
 */
export declare function utf8Over(text: string, max: number): boolean;
/**
 * Errata E-68 (13) R2-L6: the platform's default history cut lies this many blocks below the tip it read (vault-core's
 * `HISTORY_CUT_MARGIN`), so the block-hash window never has the cut as its top and never reaches above the tip.
 */
export declare const HISTORY_CUT_MARGIN = 24;
/**
 * Errata E-68 (12) L-4, (13) R2-L6, (14) R3-J3: the header hash of the block at `cut` from each source `read` asks, read
 * inside the window `[lo, hi]` of 8 to 24 consecutive heights fixed by a seed (the vault's `historyWindow`, from its own
 * key; a viewer's random seed of its own per file), asked in random order: asking again asks the same heights, so
 * repeats do not narrow it, and the cut is not its top. Residual: the window contains the cut.
 */
export declare function cutBlockHashes(read: (height: number) => Promise<string[]>, cut: number, window: [number, number]): Promise<string[]>;
export interface InitOptions {
    /**
     * The expected SHA-256 of `wasm` as 64 hex characters; default: the pinned production module
     * (`CORE_WASM_SHA256`, errata E-30). `"unchecked"` skips the check: tests with the simulated module
     * (`wasm-test/`) and nothing else.
     */
    sha256?: string | "unchecked";
}
/**
 * Initialize with a loaded module and its wasm bytes; runs the self-test. Errata E-30: the bytes are
 * instantiated only when their SHA-256 equals `opts.sha256` (default: the pin written at build time,
 * `CORE_WASM_SHA256`), else `VaultError` `WASM_INTEGRITY`. A precompiled `WebAssembly.Module` cannot be
 * checked and is refused unless `sha256` is `"unchecked"`.
 */
export declare function initCore(m: WasmModule, wasm: BufferSource | WebAssembly.Module, opts?: InitOptions): WasmModule;
export declare function core(): WasmModule;
export declare const util: {
    version: () => string;
    phraseCheck: (text: string) => void;
    classifySecret: (s: string) => "empty" | "pin" | "short" | "passphrase";
    canonicalAddress: (a: string, hrp?: string) => string;
    deployment: (chainId: string, proxy: string, opts?: {
        hrp?: string;
        localnetFast?: boolean;
        accountCodeChecksum?: string;
    }) => Deployment;
    /** 1 PRF, 2 passphrase or PIN, 3 PRF and PIN, 4 the wallet and a passphrase (errata E-72 (3)). */
    blobUnlockKind: (blob: Uint8Array) => 1 | 2 | 3 | 4;
    backupHeader: (file: Uint8Array) => {
        m_kib: number;
        t: number;
        p: number;
        ct_len: number;
    };
    ladderFloor: (a: string) => string | null;
    ladderCeil: (a: string) => string | null;
    exitSplit: (a: string, maxParts?: number) => {
        parts: string[];
        keep: string;
    };
    coarseAmount: (a: string, decimals?: number, symbol?: string) => string;
    lintEdge: (a: string, height: number, inflows: [number, string][], window: number) => {
        k: number;
        ok: boolean;
        ladder_amount: string | null;
        private_timing: boolean;
    };
    exitTiming: (now: number, maxExpiryDelta: number, sendNow?: boolean) => ExitTiming;
    /**
     * Errata E-70 (1): the expiry an exit part proves with at height `now` (its own offset from `planPrivateExit`);
     * throws `STATE` before the part's `submit_at`, so a client-held part is never proved early.
     */
    exitPartExpiry: (timing: ExitTiming, now: number, maxExpiryDelta: number) => number;
    /**
     * Errata E-28: would the proxy admit a third-party return of `slots` under the per-denomination ceilings?
     * The running total of the return's slots per denomination plus the chain's `liability` and the admission
     * window's `pending` third-party value must not exceed `ceiling` (amounts as decimal strings per denom; a
     * denomination absent from `ceiling` is unbounded). Throws `POLICY_REFUSED` with `CeilingReached: …`.
     */
    returnWithinCeiling: (slots: SlotEntry[], liability: Record<string, string>, pending: Record<string, string>, ceiling: Record<string, string>) => void;
    /** The stored count of a registered attestation root (the proxy's `attest_root` response), with the proxy's expiry rule. */
    registeredCount: (info: AttestRootInfo, attestationExpiry: number, now: number) => number;
    /** A `ChainSnapshot` from the records of WP-E's bulk feeds read at one pinned height. */
    snapshotFromFeeds: (records: FeedRecords) => ChainSnapshot;
    /**
     * E-18a: the text the wallet signs for a wallet account of `scheme` (one text; it names the vault origin,
     * the deployment, the wallet and the scheme's version). For EIP-191 `address` may be 0x… or the THORChain
     * form of the same 20 bytes (the app's EIP-712 account); the text carries the EIP-55 address.
     */
    walletMessage: (scheme: WalletSchemeName, origin: string, deployment: Deployment, address: string) => string;
    /**
     * Errata E-69: a wallet account's home, the wallet's own THORChain address (ADR-036 the signer's address,
     * EIP-191 the THORChain form of the same 20 bytes; `address` may be 0x… or that form). The settings of
     * `Vault.fromWallet` carry it as `home`; any other home is refused (`WALLET_HOME`). A rescue can be another wallet.
     */
    walletHome: (scheme: WalletSchemeName, deployment: Deployment, address: string) => string;
    /**
     * Errata E-69 (R3-E1): the text a rescue wallet signs to become the rescue of the wallet account with fingerprint
     * `account` (hex) on `deployment` ("Sign with your rescue wallet"; `scheme` the rescue wallet's).
     */
    rescueConsentMessage: (deployment: Deployment, account: Hex32, scheme: "adr036-secp256k1" | "eip191-secp256k1", rescue: string) => string;
    /**
     * Errata E-69 (R4-E1): the text the HOME wallet (`homeScheme`, `home`) of the wallet account with fingerprint
     * `account` signs to confirm `rescue` ("Confirm your rescue in your wallet": its signing window shows the rescue).
     */
    rescueBindingMessage: (deployment: Deployment, account: Hex32, homeScheme: "adr036-secp256k1" | "eip191-secp256k1", home: string, rescue: string) => string;
    /**
     * E-18a: a Transition (K contract) wallet account's K-path keys and fingerprint, from the wallet's answer(s)
     * for `walletMessage("transition-…", origin, kDeployment, address)`. `S_w` stays in WebAssembly.
     */
    transitionWalletKeys: (kDeployment: Deployment, signIn: WalletSignIn) => TransitionKeys & {
        fingerprint: Hex32;
        address: string;
    };
    /**
     * E-18b: what the UI asks the primary passkey's PRF for (WebAuthn `prf: { eval: { first: salt } }`, hex), from
     * a wallet sign-in: computed from `S_w` and the deployment, before `d` exists, the same on every device.
     */
    walletPasskeySalt: (deployment: Deployment, signIn: WalletSignIn) => Hex32;
    /** E-18: the ADR-036 sign document of that text (what `signArbitrary` signs). */
    walletSignDoc: (address: string, message: string) => Uint8Array<ArrayBufferLike>;
    /** WP-A's statement document of a proof job (secret: it carries the witness). */
    proverDocument: (job: string) => unknown;
    /** Check WP-A's prover output against the job; returns the §5.8 envelope. */
    acceptProverOutput: (job: string, out: {
        vkId: number;
        publicInputs: Uint8Array;
        piDigest: Uint8Array;
        envelope: Uint8Array;
    }) => Uint8Array<ArrayBufferLike>;
    /** E-15: the transaction size of a message (at most 1,000,000 bytes). */
    txSize: (msg: ExecuteMsg) => number;
    /** §9.2: a withdrawal or funding above 80 % of `eff(V2)` also sends a second proof. */
    secondProofRequired: (amount: string, v2: string | null) => boolean;
    /** E-15: parts that need no second proof (when the device cannot make one and no native prover helps). */
    splitBelowSecondProof: (amount: string, v2: string, maxParts?: number) => string[];
    /** C5: two snapshots from independent sources must agree exactly at one height (throws `REPLAY`). */
    crossCheckSnapshots: (a: ChainSnapshot, b: ChainSnapshot) => void;
    /** The local-chain mock prover (refuses chain ids without "local"). */
    mockProve: (job: ProofJob | string) => Uint8Array<ArrayBufferLike>;
};
/** An unlocked vault (one unlock per session, errata E-4). Lives in the vault Worker. */
export declare class Vault {
    private w;
    private constructor();
    static create(config: VaultConfig): Vault;
    static restoreFromPhrase(phrase: string, config: VaultConfig): Vault;
    static restoreFromBackup(file: Uint8Array, passphrase: string): Vault;
    static unlockPrf(blob: Uint8Array, prf: Uint8Array, config: VaultConfig): Vault;
    static unlockPassphrase(blob: Uint8Array, passphrase: string, config: VaultConfig): Vault;
    static unlockPrfAndPin(blob: Uint8Array, prf: Uint8Array, pin: string, config: VaultConfig): Vault;
    static fromPairing(qr: string, fetchedBlob: Uint8Array | null, config: VaultConfig): Vault;
    /**
     * E-18, E-18a: a Strict wallet account (`adr036` or `eip191`). Ask the wallet to sign
     * `util.walletMessage(scheme, origin, deployment, address)` and pass its raw answers: **twice** at the first
     * sign-in (they must be the same signature, `NOT_DETERMINISTIC` otherwise: threshold or MPC wallets such
     * as Vultisig sign differently each time and need the phrase account), later once with the
     * `fingerprint` kept from `walletFingerprint()` (a mismatch is `NOT_DETERMINISTIC`: ask again). Low S, the
     * key's address is the wallet's (`SIGNATURE` otherwise). Two-Key off by default. The phrase account stays
     * the recommended default; say plainly that this account is only as safe as the wallet's key. Errata E-69:
     * `config.home` is the wallet itself (`util.walletHome`), any other home is refused (`WALLET_HOME`); the
     * rescue can be another wallet.
     */
    static fromWallet(p: WalletSignIn & {
        deployment: Deployment;
        level: WalletLevelName;
        passkeyPrf?: Uint8Array | string;
        config: VaultConfig;
    }): Vault;
    /** E-18b: what this session's passkey is to the account on `dep` (sync first). */
    passkeyCheck(dep: string): PasskeyCheck;
    /**
     * E-18b: where an account switch (wallet only → passkey) stands (sync first). `unfinished`: a passkey
     * generation is on chain and wallet-only notes are left (an interrupted switch); `resumable_here`: this is
     * a wallet-only session, so `beginUpgradeToPasskey` with the same passkey continues it (a passkey session
     * opens the wallet-only level from the same wallet sign-in for that).
     */
    switchState(dep: string): SwitchState;
    /**
     * E-18b: upgrade a wallet-only account to the passkey level, a private re-note: `{ vault, steps }` like
     * `beginUpgradeToPhrase` (the new vault writes its header; each `move_note` step funds a fresh account of it).
     * Sync this vault first: an interrupted switch resumes with the same passkey (no `write_new_header` step
     * when its generation is on chain; only the notes still in the wallet-only generation move); another
     * passkey is refused (`WALLET_ACCOUNT`).
     */
    beginUpgradeToPasskey(dep: string, passkeyPrf: Uint8Array | string): {
        vault: Vault;
        steps: unknown[];
        view_key_warning?: string;
        history_warning?: string;
    };
    /** E-18b "bring everything home", the notes (one FAST withdrawal home each; prove, release, relay). */
    planHomeWithdrawals(dep: string, denom: string | null, opts: SpendOptions): {
        spends: SpendPlan[];
        skipped: string[];
    };
    /**
     * Errata E-67 (2), review F3: for a lost or compromised home, every note moved to its generation's rescue with a
     * FAST withdrawal (`home_only`; prove, release, relay each): the default over the proof-free exit to rescue.
     */
    planRescueWithdrawals(dep: string, denom: string | null, opts: SpendOptions): {
        spends: SpendPlan[];
        skipped: string[];
    };
    /** E-18b "bring everything home", the Spending accounts (a safe-key sweep home each; relay). */
    planHomeSweeps(dep: string, expiryHeight: number): {
        account_sweeps: ExecuteMsg[];
        skipped: string[];
    };
    /** E-18a: this wallet account's fingerprint (not secret): keep it to open the account later with one signature. */
    walletFingerprint(): Hex32;
    /**
     * E-18a: the K contract's keys of this phrase account on a K deployment (the Transition profile): S stays
     * inside. A wallet account uses `util.transitionWalletKeys` with a Transition scheme (`WALLET_ACCOUNT` here).
     */
    transitionKeys(kDeployment: Deployment): TransitionKeys;
    /** E-18: `{ kind: "phrase" }` or `{ kind: "wallet", scheme, origin, address, deployment_id, two_key }`. */
    accountKind(): AccountKind;
    /** E-18: upgrade a wallet account to a phrase account: a private move, walked like a phrase rotation. */
    beginUpgradeToPhrase(dep: string): {
        vault: Vault;
        steps: unknown[];
        view_key_warning?: string;
        history_warning?: string;
    };
    phrase(): string;
    phraseChallenge(): number[];
    confirmPhraseWords(answers: [number, string][]): boolean;
    confirmBackupFile(file: Uint8Array, passphrase: string): void;
    get backupConfirmed(): boolean;
    /**
     * Errata E-63: open a passkey backup (`backupFile` with `includeDeviceFactor` at the wallet + passkey level) of
     * this account: its `d` reaches the lost passkey's exit addresses (keying `s_d_backup`): `exit_addresses`; `own`: this
     * session's own `d`. Errata E-72 (1): on a session opened with the wallet alone (`fromWallet` with `home-only`) whose
     * synced deployment shows a written header binding the file's `d`, the `d` becomes the session's: `session` (the full
     * account: `passkeyCheck` says `matches`; it deposits, pairs and seals).
     */
    restorePasskeyBackup(file: Uint8Array, passphrase: string): PasskeyRestore;
    /**
     * Errata E-72 (1), review E72-1: after `other_generations`, adopt the file's `d` because header generation
     * `generation` on `dep` (which binds it, shown by a cross-checked sync) is the person's own: `session`. `STATE` when
     * that generation is not written there, does not bind the file's passkey, or came from a one-source sync.
     */
    restorePasskeyBackupAs(file: Uint8Array, passphrase: string, dep: string, generation: number): PasskeyRestore;
    /**
     * Errata E-72 (1), review E72-1: every written header generation with whose passkey binds it (`file`, `wallet_only`,
     * `session`, `other`), its height, the unspent notes under it and their amounts, and whether the sync was cross-checked:
     * what the vault UI shows before the person names the generation that is theirs. Nothing is adopted.
     */
    passkeyBackupGenerations(file: Uint8Array, passphrase: string): PasskeyBackupGeneration[];
    backupFile(passphrase: string, opts?: {
        desktop?: boolean;
        includeDeviceFactor?: boolean;
    }): Uint8Array;
    sealDevicePrf(prf: Uint8Array): Uint8Array;
    sealDevicePassphrase(passphrase: string): Uint8Array;
    sealDevicePrfAndPin(prf: Uint8Array, pin: string): Uint8Array;
    /**
     * Errata E-72 (3): seal this device's blob under the wallet's `S` and a passphrase (unlock kind 4): a wallet account on
     * a device without passkeys. `unsealDevice` on the wallet's own home-only session opens it; the blob alone opens
     * nothing. A phrase account seals under a passphrase instead (`WALLET_ACCOUNT`).
     */
    sealDeviceWallet(passphrase: string): Uint8Array;
    /**
     * Errata E-72 (3): this device's blob by what the device has: a passkey's PRF output (kind 1), with a PIN (kind 3), or a
     * passphrase: kind 4 for a wallet account (the wallet and the passphrase open it), kind 2 for a phrase account.
     */
    sealDevice(opts: {
        prf?: Uint8Array;
        pin?: string;
        passphrase?: string;
    }): Uint8Array;
    /**
     * Errata E-72 (3): open this device's kind-4 blob into this wallet + passkey session opened with the wallet alone
     * (`fromWallet` with `home-only`): the session is then the passkey session (`matches` after a sync). The blob must be
     * this account's (`STATE`, `WALLET_ACCOUNT`); a session holding `d` takes none (`STATE`); kinds 1 to 3 open with
     * `unlockPrf` and the others (`INVALID_INPUT`).
     */
    unsealDevice(blob: Uint8Array, opts: {
        passphrase: string;
    }): void;
    /**
     * "Approve this device": a pairing code for a new device, which then opens the account with `Vault.fromPairing`
     * without the wallet. Errata E-72 (2): a wallet account's code names the account (its home is the wallet's).
     */
    pairingOffer(): {
        qr_inline: string;
        qr_by_id: string;
        blob: string;
        blob_id: string;
        new_device_id: number;
    };
    restoredCounters(): unknown[];
    applyRestoredCounters(): void;
    get hasDeviceFactor(): boolean;
    newDeviceFactor(): void;
    setConfirmPolicy(p: ConfirmPolicy): void;
    config(): VaultConfig;
    /** This device's id in a deployment (hex id), or without one the id the session was opened with. */
    deviceId(dep?: string): number;
    /**
     * Change home and rescue (`rescue: null` clears it) while the current header is only planned. Once it is
     * committed both are fixed in it (§3.7): `STATE`; then a new generation (`beginGenerationRotation`) does it.
     * Checked as at creation (`INVALID_ADDRESS`).
     */
    setDestinations(p: {
        home: string;
        rescue: string | null;
    }): void;
    /**
     * Pass 11b (errata E-34): the home and rescue of an older header generation, on a device restored with
     * another home (the sync warns while a generation that holds notes has none); they must hash to its `Hd`,
     * `Rd`. A redirect home or veto home of a payout from that generation's notes needs them.
     */
    setGenerationDestinations(dep: string, generation: number, home: string, rescue: string | null): void;
    attach(d: Deployment): string;
    /** The current generation's header plan (what its commit and reveal carry), without the chain checks. */
    headerPlan(dep: string): {
        generation: number;
        tau: Hex32;
        values: {
            g: Hex32;
            v: Hex32;
            rules: Hex32;
            hd: Hex32;
            rd: Hex32;
        };
        salt: Hex32;
        commitment: Hex32;
    };
    /**
     * C4: where the current header generation stands and the next step: `sync` (read the chain first),
     * `commit`, `reveal`, `done` (deposits open) or `blocked` (with `reason`). `writeHeader` walks it.
     */
    headerReport(dep: string): HeaderReport;
    /**
     * C4: `header_commit` of the current generation. `NEEDS_SYNC` before the chain was read; `STATE` when the
     * chain shows the generation written already (nothing to write: never send it again).
     */
    headerCommitMsg(dep: string): ExecuteMsg;
    /**
     * C4: `header_reveal`, after the commit was seen included (`headerCommitted`; `STATE` otherwise) and a
     * sync newer than it (`NEEDS_SYNC` otherwise).
     */
    headerRevealMsg(dep: string): ExecuteMsg;
    /** The header commit was included at `height` (call it only after inclusion: the reveal needs it). */
    headerCommitted(dep: string, height: number): void;
    /** The chain refused the reveal with `UnknownCommitment` (the commit is not on chain): commit again. */
    headerCommitLost(dep: string): void;
    /**
     * Sync from a snapshot (C5). `opts.deep` scans far beyond the spec's gaps (a restore that misses money);
     * notes found beyond them show `reachable: false` in `notes()` and should be moved (fund a Spending
     * account and return) so the phrase alone finds them.
     */
    sync(dep: string, snapshot: ChainSnapshot | string, opts?: SyncOptions): void;
    /**
     * Errata E-38 (C5): sync from two snapshots of independent sources at one height; they must be equal
     * (`REPLAY` otherwise, and nothing changes). `sync` with one snapshot is a degraded sync: `syncStatus`
     * and a warning say so.
     */
    syncChecked(dep: string, a: ChainSnapshot | string, b: ChainSnapshot | string, opts?: SyncOptions): void;
    /** Errata E-38: this session's last sync (`sources`: 2 cross-checked, 1 one source, 0 none). */
    syncStatus(dep: string): SyncStatus;
    balances(dep: string): Record<string, string>;
    notes(dep: string): NoteView[];
    accounts(dep: string): Record<string, {
        index: number;
        address: string;
        nonce: number;
        funding_nonce: number;
        on_chain: boolean;
        [k: string]: unknown;
    }>;
    warnings(dep: string): string[];
    prepareDeposit(dep: string, depositor: string, denom: string, amount: string): DepositPlan;
    /**
     * Check the node's attestation and build the wallet's `deposit` message. The prepared deposit keeps its
     * counter until a sync is past the attestation's expiry (errata E-32): `abandonDeposit` when the wallet did
     * not send it.
     */
    finishDeposit(dep: string, plan: DepositPlan, att: NodeAttestation, now: number, attestVk?: string, registeredCount?: number): FinishedDeposit;
    /** A prepared deposit the wallet did not send (cancelled, refused to sign): its counter is free again. */
    abandonDeposit(dep: string, inner: Hex32): boolean;
    /**
     * One or two input notes of one header generation covering `amount` (vault-core `select_inputs`);
     * `deviceOnly` keeps to the generations this device holds `d` for (a third-party withdrawal, a funding:
     * the other generations pay home or rescue only, spec §3.6).
     */
    selectInputs(dep: string, denom: string, amount: string, deviceOnly?: boolean): string[];
    /**
     * Errata E-68 (13) R2-L4: the inputs of a funding of a Spending account (`selectInputs` with `deviceOnly`), skipping
     * the notes a history file's holder can follow (merge those first, `historyMovePlan`).
     */
    selectFundingInputs(dep: string, denom: string, amount: string): string[];
    prepareSpend(dep: string, inputs: string[], amount: string, kind: SpendKind, opts: SpendOptions): SpendPlan;
    /** The proof job with the witness: only for the vault's prover Worker. */
    proofJob(actionId: number): ProofJob;
    proofJobJson(actionId: number): string;
    /** The second proof's job (E-15: FAST2 at 0x0204); fresh randomness per call; available after release. */
    secondProofJob(actionId: number): ProofJob;
    secondProofJobJson(actionId: number): string;
    secondProofDone(actionId: number): void;
    secondProofsDue(): number[];
    /** Fresh randomness for a prepared action's proof (after `MESSAGE_TOO_LARGE`). */
    refreshProof(actionId: number): void;
    secondProofBody(actionId: number, envelope: Uint8Array): {
        nullifier: string;
        stmt_id: number;
        public_inputs: string;
        proof: string;
    };
    /** E-4: silent unless the owner opted into confirmations (then CONFIRMATION_REQUIRED). */
    release(actionId: number, envelope: Uint8Array): ExecuteMsg;
    abandon(actionId: number): void;
    /**
     * C3: free the notes (`handles`) a released action holds after its relay failed, so they can be proved
     * again for another node. `refused`: the node refused the relay (nothing was submitted); `expired`: only
     * once a sync has passed the action's expiry height (a sync frees those by itself too; earlier is
     * `STATE`). A note of a prepared, unreleased action is `STATE`: `abandon` that action. Returns the freed
     * nullifiers.
     */
    expireReservation(dep: string, handles: string[], why: FreeInputs): Hex32[];
    /** C3: `expireReservation` for every input of a released action of this session, by its id. */
    expireAction(actionId: number, why: FreeInputs): Hex32[];
    confirmationRequest(actionId: number): ConfirmRequest | null;
    confirmPasskey(actionId: number, challengeHex: string): void;
    confirmPin(actionId: number, pin: string): void;
    /** E-13: announce a withdrawal that goes out in parts; one card and (if opted in) one confirmation. */
    /**
     * Review RF-03 of the E-70 fixes: `timings` (one per part, `planPrivateExit`'s) are kept in the withdrawal's own record
     * (`withdrawals()[i].timings`); a part to a fresh exit address needs one (`STATE` otherwise).
     */
    beginWithdrawal(dep: string, denom: string, parts: [string, string][], fee: FeeTerms, expiryHeight: number, timings?: ExitTiming[] | null): WithdrawalPlan;
    cancelWithdrawal(withdrawalId: number): void;
    withdrawals(): {
        withdrawal_id: number;
        card: ReviewCard;
        released: boolean[];
        confirmed_by: string | null;
        timings?: (ExitTiming | null)[];
    }[];
    authorizations(): AuthorizationRecord[];
    pendingActions(): unknown[];
    newAccount(dep: string, scope: unknown, policy?: Policy, loosenDelay?: number): any;
    accountForTask(dep: string, task: string): any;
    /** Errata E-70 (7): account `n`'s creation was refused `SafeKeyInUse`: retire it (the next allocation takes the next index). */
    accountSquatted(dep: string, n: number): void;
    createAccountMsg(dep: string, n: number): ExecuteMsg;
    /**
     * A signed Spending call. Errata E-39: under an opted-in confirmation policy a full-key call that moves
     * value where the policy covers throws `CONFIRMATION_REQUIRED`; use `prepareCall`, confirm it like an
     * action (`confirmationRequest`, `confirmPasskey` / `confirmPin`) and `releaseCall`.
     */
    accountCall(dep: string, n: number, key: KeyKind, calls: Call[], fees: CallFees, expiry: number, feeAuthorization?: unknown): ExecuteMsg;
    /**
     * Errata E-39: a Spending call checked and carded, not yet signed (`abandon(call_id)` drops it). `quotes`
     * (pass 11b): the platform's swap quotes; under an opted-in policy a swap to the account itself asks unless
     * its limit is within the tolerance (3 %) of one of the same asset, coin and amount (none: every swap asks).
     */
    prepareCall(dep: string, n: number, key: KeyKind, calls: Call[], fees: CallFees, expiry: number, feeAuthorization?: unknown, quotes?: SwapQuote[]): CallPlan;
    /** Errata E-39: sign a prepared call (after its confirmation when it needs one); logged in `authorizations()`. */
    releaseCall(callId: number): ExecuteMsg;
    /**
     * Errata E-28: would the proxy accept `calls` from the account's safe key? Only registered close variants
     * whose body the rule allows (`rules`: the proxy's `close_variants` entries, each `{contract, variant,
     * body?}`; a `code:<id>` rule expanded to the contracts it means). Throws `POLICY_REFUSED` with
     * `SafeKeyNotAllowed: …` otherwise. A lint before `accountCall(…, "safe", …)`; the proxy stays the authority.
     */
    checkSafeClose(calls: Call[], relayerFee: Coin | null, rules: CloseRule[]): void;
    prepareReturn(dep: string, n: number, coins: Coin[], expiry: number): any;
    finishReturn(dep: string, plan: unknown, by: "full" | "safe" | `order:${number}`, att: NodeAttestation | null, now: number, attestVk?: string, registeredCount?: number): ExecuteMsg;
    standingOrder(dep: string, n: number, key: KeyKind, orderId: number, minAmounts: Coin[], maxReturns: number, orderExpiry: number, expiry: number): ExecuteMsg;
    refreshSlots(dep: string, n: number, expiry: number): ExecuteMsg;
    sweepHome(dep: string, n: number, key: KeyKind, to: Destination, destGeneration: number, expiry: number): ExecuteMsg;
    /**
     * Errata E-25: `requestHex` is the vetoed request's pi_digest (its `slows` record, or the rotation step's
     * `request`). Errata E-34: a veto home goes to the home of the request's note's generation and, with
     * `mode` `"bunker_k"`, carries the destination proof the proxy requires there (to rescue if one is set).
     * A veto home publishes `hsalt` (errata E-33: rotate the phrase afterwards).
     */
    veto(dep: string, nullifierHex: string, requestHex: string, home: boolean, expiry: number, mode?: ChainMode): ExecuteMsg;
    /**
     * Errata E-34: the queued payouts of this vault's spends (last sync). `to_own: false` pays a recipient:
     * one the owner did not make is a withdrawal by someone holding S and d: `queueRedirectHome` it before it
     * pays (home wins, D12). Pass 11b: `authorized_here` says this vault authorized it; warn only when it and
     * `to_own` are both false.
     */
    myQueueItems(dep: string): MyQueueItem[];
    /**
     * Errata E-34: `queue_redirect_home` for one of `myQueueItems`' items, to the home of the spent notes'
     * generation; with `mode` `"bunker_k"` it carries the destination proof (to rescue if one is set). It
     * publishes `lsalt` or `hsalt` (errata E-33: rotate the phrase afterwards).
     */
    queueRedirectHome(dep: string, item: QueueFeedRecord, mode?: ChainMode): ExecuteMsg;
    /** Errata E-34: `to` pins the notes' exit destination (E-29, E-31a); without it, no pin. */
    exitLock(dep: string, handles: string[], to?: Destination): ExecuteMsg;
    planExit(dep: string, handles: string[], to: Destination, opts?: {
        chunk?: number;
        revealAncestry?: number;
        mode?: ChainMode;
    }): ExitPlan;
    markAudited(dep: string, indices: number[]): void;
    scheduleLineageAudits(dep: string, mode: ChainMode, proactive?: boolean, chunk?: number): [ExecuteMsg, number[]][];
    lineageReport(dep: string): {
        handle: string;
        index: number;
        unaudited_ancestors: number;
    }[];
    rotationAdvice(dep: string): unknown[];
    /**
     * What a view key with `options` names and reveals, what it can never do, the warnings, and its fingerprint.
     * It reads the chain first (errata E-66 (3) fix): `a` and `b` two independent sources at one height (C5; `b`
     * null: one source), `opts.min_height` the tip the platform read itself (required).
     */
    viewKeyDisclosure(dep: string, options: ViewKeyOptions, a: ChainSnapshot | string, b: ChainSnapshot | string | null, opts: SyncOptions): ViewKeyDisclosure;
    /**
     * The view-key file, only with the fingerprint its disclosure showed, at the height that disclosure read (no
     * sync since; `CONFIRMATION_REQUIRED` otherwise).
     */
    exportViewKey(dep: string, options: ViewKeyOptions, fingerprint: string): ViewKeyExport;
    /** The records of the view keys exported for this account. */
    viewKeyExports(dep: string): ViewKeyExportRecord[];
    /**
     * What a history file with `options` lists and shows, what its holder can never do, the warnings, and its
     * fingerprint. It reads the chain first: `a` and `b` two independent sources at one height (C5; `b` null: one
     * source), `opts.min_height` the tip the platform read itself (required), `blockHashes` the header hash of the block
     * at the cut height from each source the platform read it from (one or two, hex).
     */
    historyDisclosure(dep: string, options: HistoryOptions, a: ChainSnapshot | string, b: ChainSnapshot | string | null, opts: SyncOptions, blockHashes: string[], activity?: AccountActivity[]): HistoryDisclosure;
    /** Errata E-68 (13) R2-L6: the heights `[lo, hi]` whose header hashes the platform reads for a history cut at `cut`. */
    historyWindow(dep: string, cut: number): [number, number];
    /** The history file of the last disclosure, only with its fingerprint and while no sync happened since (`CONFIRMATION_REQUIRED`). */
    exportHistory(dep: string, fingerprint: string): HistoryExport;
    /** The records of the history files exported for this account. */
    historyExports(dep: string): HistoryExportRecord[];
    /** Errata E-68 (12) L-1: the history files out whose held notes are unspent, and those notes. */
    historyNotesUnspent(dep: string): {
        files: string[];
        notes: Hex32[];
    };
    /** Errata E-68 (12) L-1: the move-first path (merge each pair, spend each single once). */
    historyMovePlan(dep: string): HistoryMovePlan;
    /**
     * Errata E-68 (12) L-1, (13) Info 7: acknowledge the exposure for the one message `action` names (an exit of these
     * notes to this destination, the lineage audits, a veto home of this request, a redirect home of this queue item); a
     * build that fails keeps it.
     */
    acknowledgeHistoryExposure(dep: string, action: HistoryAckAction): Hex32[];
    /**
     * E-12: start a phrase rotation; returns the new vault and the steps (veto, new header, moves, sweeps).
     * `view_key_warning` (errata E-66 (5)(b), (8), view-key audit run-1 M4): set when a view key of this account was
     * given out: its holder will see where the moved value lands. Show it before the move.
     */
    beginPhraseRotation(dep: string): {
        vault: Vault;
        steps: unknown[];
        view_key_warning?: string;
        history_warning?: string;
    };
    /** E-12 step 3 (`amount`: one part of the note's move, errata E-70 (3), `MoveNote.parts`; omitted: the whole note). */
    rotationMoveNote(newVault: Vault, dep: string, handle: string, opts: SpendOptions, amount?: string): {
        plan: SpendPlan;
        new_account_index: number;
    };
    beginGenerationRotation(dep: string, opts: {
        home?: string;
        rescue?: string;
        clearRescue?: boolean;
        newDevice?: boolean;
    }): number;
    freshExitAddress(dep: string): string;
    /** Errata E-61: the exit-address scan (every keying this session derives, `gap` indices past the last issued). */
    exitAddresses(dep: string, gap: number): {
        index: number;
        address: string;
        keying: ExitKeying;
        issued: boolean;
    }[];
    noteExitUsed(dep: string, n: number, keying: ExitKeying): void;
    /** Errata E-61, "Send home": the signed send (`tx_bytes` base64) of an exit address's coins to home. */
    exitSendHome(dep: string, address: string, req: {
        account_number: number;
        sequence: number;
        balances: Coin[];
        native_fee?: string;
        gas_limit?: number;
    }): {
        tx_bytes: string;
        from: string;
        to: string;
        coins: Coin[];
    };
    /** Errata E-62: the restart's state. */
    restartReport(dep: string): RestartReport;
    restartWithThisPasskey(dep: string): RestartReport;
    restartSendHome(dep: string, denom: string | null, opts: SpendOptions): {
        spends: SpendPlan[];
        skipped: string[];
    };
    restartMoveAccount(dep: string): {
        index: number;
        address: string;
        on_chain: boolean;
    };
    prepareRestartMove(dep: string, cm: string, opts: SpendOptions): SpendPlan;
    /**
     * §9.4 with errata E-70 (1): up to `maxParts` ladder parts, each to its own fresh address with its own timing: prove
     * a part no earlier than `timing.submit_at`, with `util.exitPartExpiry(timing, height, mde)` as its expiry and
     * `timing.node_hold_blocks` as its node hold (none when `send_now`).
     */
    planPrivateExit(dep: string, amount: string, maxParts: number, now: number, sendNow?: boolean): {
        address: string;
        amount: string;
        timing: ExitTiming;
    }[];
    delegate(dep: string, n: number, agentVk: string, policy: Policy, delegationExpiry: number, canReturn: boolean, now: number, expiry: number): ExecuteMsg;
    revokeDelegation(dep: string, n: number, delegationId: number, key: KeyKind, expiry: number): ExecuteMsg;
    freezeAgents(dep: string, n: number, key: KeyKind, expiry: number): ExecuteMsg;
    agentSlots(dep: string, n: number, count: number): unknown[];
    exportState(dep: string): Uint8Array;
    importState(d: Deployment, blob: Uint8Array): string;
    stateBlob(dep: string, version: number): {
        id: string;
        token: string;
        blob: string;
    };
    /** Errata E-68 (13) R2-L2: the id of this account's state blob (`GET /blob/{id}`). */
    stateBlobId(dep: string): Hex32;
    /**
     * Errata E-68 (13) R2-L2: apply a state blob another device wrote (raw bytes; only ever adds: counters, the address
     * book, the published-opening mark, history export records). `REPLAY` below the version floor. Returns its version.
     */
    applyStateBlob(dep: string, blob: Uint8Array): number;
    /** Errata E-68 (13) R2-L2: the version floor (write floor + 1). */
    stateBlobFloor(dep: string): number;
    /** Errata E-68 (13) R2-L2: a node took the blob of `version`: the floor rises to it. */
    stateBlobWritten(dep: string, version: number): void;
    /**
     * Errata E-69 (R3-E1): the text the rescue wallet signs to become this wallet account's rescue ("Sign with your
     * rescue wallet"); `scheme` is the rescue wallet's.
     */
    rescueConsentMessage(dep: string, scheme: "adr036-secp256k1" | "eip191-secp256k1", rescue: string): string;
    /**
     * Errata E-69 (R4-E1): the text this account's own (home) wallet signs to confirm `rescue` ("Confirm your rescue in
     * your wallet": the rescue address shows in its signing window).
     */
    rescueBindingMessage(dep: string, rescue: string): string;
    /**
     * Errata E-69 (R3-E1, R4-E1): keep the rescue's consent (both answers, verified now); then set the rescue as usual.
     */
    setRescueConsent(consent: RescueConsent): void;
    /** Lock: every secret is dropped; afterwards every call answers `LOCKED`. */
    lock(): void;
}
/** The agent side: an agent key and its delegation. Never `S` or `d`. */
export declare class Agent {
    private readonly w;
    private constructor();
    static generate(): Agent;
    static open(file: Uint8Array, passphrase: string): Agent;
    get vk(): string;
    seal(passphrase: string): Uint8Array;
    setDelegation(delegation: unknown, destinations: Record<string, string>, slots?: unknown[]): void;
    delegation(): any;
    check(calls: Call[], relayerFee: Coin | null, now: number): unknown;
    execute(calls: Call[], fees: CallFees, now: number): ExecuteMsg;
    pay(destId: string, denom: string, amount: string, fees: CallFees, now: number): ExecuteMsg;
    /** A THORChain swap back to the account itself (D16). */
    swapToSelf(denom: string, asset: {
        chain: string;
        symbol: string;
        ticker: string;
        secured: boolean;
    }, amount: string, toAsset: string, minOut: string | null, fees: CallFees, now: number): ExecuteMsg;
    revokeSelf(now: number): ExecuteMsg;
    agentReturn(coins: Coin[], now: number): ExecuteMsg;
}
/** What `writeHeader` needs from the platform: a relay that returns once included, and the chain's view. */
export interface HeaderIo {
    /** Relay one message through a node and wait until it is included; the inclusion height. A refusal throws. */
    submit(msg: ExecuteMsg): Promise<{
        height: number;
    }>;
    /** The bulk feeds at one height (C5). */
    readSnapshot(): Promise<ChainSnapshot>;
    /** A pause before the chain is read again (a node that trails the block the commit landed in). */
    pause?(): Promise<void>;
}
/**
 * C4, the header of the current generation written before the first deposit into it, driven by vault-core's
 * `headerReport` (never the app's own records: those cannot know what the chain shows). Each step is
 * idempotent: a generation the chain shows written is never sent again (the cause of `HeaderFinal` /
 * `HeaderExists` refusals), a commit is revealed only once it was seen included and after a sync newer than
 * it, a commit whose relay failed is sent again on the next run (errata E-32), a reveal refused with
 * `UnknownCommitment` commits again, and a sync that shows the number taken by another header moves the plan
 * on. Callers run one at a time per vault (single flight).
 */
export declare function writeHeader(v: Vault, dep: string, io: HeaderIo, maxSteps?: number): Promise<HeaderReport>;
