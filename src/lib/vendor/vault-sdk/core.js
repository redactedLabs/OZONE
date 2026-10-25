// Typed access to vault-core's wasm module. The module is injected (`initCore`), so the same code runs in
// the vault Worker (fetching the .wasm), in Node (reading it from disk) and in tests (the build with the
// simulated proxy). Errata E-30: `initCore` instantiates the bytes only when their SHA-256 is the value
// pinned at build time (`checksums.ts`); tests with the simulated module say so explicitly.
import { CORE_WASM_SHA256 } from "./checksums.js";
import { sha256Hex } from "./sha256.js";
/** An error from vault-core: `code` is stable (e.g. `PHRASE_CHECKSUM`, `CONFIRMATION_REQUIRED`). */
export class VaultError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "VaultError";
    }
}
export function asVaultError(e) {
    if (e instanceof VaultError)
        return e;
    const msg = e instanceof Error ? e.message : String(e);
    const m = /^([A-Z][A-Z0-9_]+): ([\s\S]*)$/.exec(msg);
    if (m)
        return new VaultError(m[1], m[2]);
    // a wasm handle used after `lock()` (or after it was handed over, e.g. `takeNewVault`)
    if (/null pointer passed to rust|attempted to take ownership of Rust value while it was borrowed/.test(msg))
        return new VaultError("LOCKED", "this vault handle is locked or was handed over");
    return new VaultError("UNKNOWN", msg);
}
/** Errata E-66 (1), E-68 (1): the largest view-key and history texts the parsers read (the SDK refuses longer ones before the module copies them, E-68 (12) I-2). */
export const VIEW_KEY_MAX_BYTES = 1 << 20;
export const HISTORY_MAX_BYTES = 16 << 20;
/**
 * Errata E-68 (13) R2-I2: whether `text` is longer than `max` bytes of UTF-8, counted without copying (a JS string
 * counts UTF-16 code units: up to three bytes each). Stops counting once past `max`.
 */
export function utf8Over(text, max) {
    if (text.length > max)
        return true;
    if (text.length * 3 <= max)
        return false;
    let n = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c < 0x80)
            n += 1;
        else if (c < 0x800)
            n += 2;
        else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
            n += 4;
            i++;
        }
        else
            n += 3;
        if (n > max)
            return true;
    }
    return false;
}
/**
 * Errata E-68 (13) R2-L6: the platform's default history cut lies this many blocks below the tip it read (vault-core's
 * `HISTORY_CUT_MARGIN`), so the block-hash window never has the cut as its top and never reaches above the tip.
 */
export const HISTORY_CUT_MARGIN = 24;
function randomBelow32(n) {
    const r = new Uint32Array(1);
    globalThis.crypto.getRandomValues(r);
    return r[0] % n;
}
/**
 * Errata E-68 (12) L-4, (13) R2-L6, (14) R3-J3: the header hash of the block at `cut` from each source `read` asks, read
 * inside the window `[lo, hi]` of 8 to 24 consecutive heights fixed by a seed (the vault's `historyWindow`, from its own
 * key; a viewer's random seed of its own per file), asked in random order: asking again asks the same heights, so
 * repeats do not narrow it, and the cut is not its top. Residual: the window contains the cut.
 */
export async function cutBlockHashes(read, cut, window) {
    const [lo, hi] = window;
    if (!(lo <= cut && cut <= hi && hi - lo < 24))
        throw new VaultError("INVALID_INPUT", "the block window must contain the cut");
    const heights = [];
    for (let h = lo; h <= hi; h++)
        heights.push(h);
    for (let i = heights.length - 1; i > 0; i--) {
        const j = randomBelow32(i + 1);
        [heights[i], heights[j]] = [heights[j], heights[i]];
    }
    let mine = null;
    for (const h of heights) {
        const x = await read(h);
        if (h === cut)
            mine = x;
    }
    if (!mine || mine.length < 1 || mine.length > 2)
        throw new VaultError("INVALID_INPUT", "the block hash at the cut from one or two sources");
    return mine.map((x) => x.toLowerCase());
}
/** What a `Vault` holds after `lock()`: every call answers `LOCKED`. */
const LOCKED_HANDLE = new Proxy({}, {
    get: () => () => {
        throw new VaultError("LOCKED", "the vault is locked: unlock it again");
    },
});
/**
 * `SyncOptions` as vault-core reads them: `deep`, and errata E-48's `min_height` (the tip the caller read
 * itself) when set; dropping it would let a feed node tag the vault with an old root again.
 */
function syncOptionsJson(opts) {
    return JSON.stringify({ deep: opts.deep ?? false, ...(opts.min_height === undefined ? {} : { min_height: opts.min_height }) });
}
function call(f) {
    try {
        return f();
    }
    catch (e) {
        throw asVaultError(e);
    }
}
const big = (n) => BigInt(n);
const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
/**
 * A wallet sign-in for vault-core: the raw answers, unchanged. ADR-036 `StdSignature`s must all carry the
 * same secp256k1 public key; EIP-191 answers are hex strings.
 */
function signInJson(p) {
    const sigs = p.signatures;
    if (sigs.length < 1 || sigs.length > 2)
        throw new VaultError("SIGNATURE", "one signature (with the fingerprint) or two");
    const evm = p.scheme.includes("eip191");
    let publicKey;
    const raw = sigs.map((x) => {
        if (evm) {
            if (typeof x !== "string")
                throw new VaultError("SIGNATURE", "personal_sign answers are hex strings, as the wallet returned them");
            return x;
        }
        if (typeof x !== "object" || x === null || x.pub_key?.type !== "tendermint/PubKeySecp256k1")
            throw new VaultError("SIGNATURE", "an ADR-036 secp256k1 signature is needed");
        if (publicKey !== undefined && publicKey !== x.pub_key.value)
            throw new VaultError("NOT_DETERMINISTIC", "the two signatures came from different keys");
        publicKey = x.pub_key.value;
        return x.signature;
    });
    return JSON.stringify({ scheme: p.scheme, origin: p.origin, address: p.address, ...(publicKey !== undefined && { public_key: publicKey }), signatures: raw, ...(p.fingerprint !== undefined && { fingerprint: p.fingerprint }) });
}
let mod = null;
const HEX64 = /^[0-9a-f]{64}$/;
/**
 * Initialize with a loaded module and its wasm bytes; runs the self-test. Errata E-30: the bytes are
 * instantiated only when their SHA-256 equals `opts.sha256` (default: the pin written at build time,
 * `CORE_WASM_SHA256`), else `VaultError` `WASM_INTEGRITY`. A precompiled `WebAssembly.Module` cannot be
 * checked and is refused unless `sha256` is `"unchecked"`.
 */
export function initCore(m, wasm, opts = {}) {
    const expected = (opts.sha256 ?? CORE_WASM_SHA256).toLowerCase();
    if (expected !== "unchecked") {
        if (!HEX64.test(expected))
            throw new VaultError("WASM_INTEGRITY", "sha256 must be 64 hex characters or \"unchecked\"");
        if (wasm instanceof WebAssembly.Module)
            throw new VaultError("WASM_INTEGRITY", "a compiled module cannot be checked; pass the bytes");
        const got = sha256Hex(wasm);
        if (got !== expected)
            throw new VaultError("WASM_INTEGRITY", `vault_core_bg.wasm sha256 ${got} != ${expected}`);
    }
    m.initSync({ module: wasm });
    call(() => m.selftest());
    mod = m;
    return m;
}
export function core() {
    if (!mod)
        throw new VaultError("NOT_INITIALIZED", "call initCore first");
    return mod;
}
export const util = {
    version: () => core().version(),
    phraseCheck: (text) => call(() => core().phraseCheck(text)),
    classifySecret: (s) => core().classifySecret(s),
    canonicalAddress: (a, hrp = "thor") => call(() => core().canonicalAddress(a, hrp)),
    deployment: (chainId, proxy, opts = {}) => JSON.parse(call(() => core().newDeployment(chainId, proxy, opts.hrp ?? "thor", opts.localnetFast ?? false, opts.accountCodeChecksum ?? null))),
    blobUnlockKind: (blob) => call(() => core().blobUnlockKind(blob)),
    backupHeader: (file) => JSON.parse(call(() => core().backupHeader(file))),
    ladderFloor: (a) => call(() => core().ladderFloor(a)) ?? null,
    ladderCeil: (a) => call(() => core().ladderCeil(a)) ?? null,
    exitSplit: (a, maxParts = 3) => JSON.parse(call(() => core().exitSplit(a, maxParts))),
    coarseAmount: (a, decimals = 8, symbol = "RUNE") => call(() => core().coarseAmount(a, decimals, symbol)),
    lintEdge: (a, height, inflows, window) => JSON.parse(call(() => core().lintEdge(a, big(height), JSON.stringify(inflows), big(window)))),
    exitTiming: (now, maxExpiryDelta, sendNow = false) => JSON.parse(call(() => core().exitTiming(big(now), big(maxExpiryDelta), sendNow))),
    /**
     * Errata E-28: would the proxy admit a third-party return of `slots` under the per-denomination ceilings?
     * The running total of the return's slots per denomination plus the chain's `liability` and the admission
     * window's `pending` third-party value must not exceed `ceiling` (amounts as decimal strings per denom; a
     * denomination absent from `ceiling` is unbounded). Throws `POLICY_REFUSED` with `CeilingReached: …`.
     */
    returnWithinCeiling: (slots, liability, pending, ceiling) => call(() => core().returnWithinCeiling(JSON.stringify(slots), JSON.stringify(liability), JSON.stringify(pending), JSON.stringify(ceiling))),
    /** The stored count of a registered attestation root (the proxy's `attest_root` response), with the proxy's expiry rule. */
    registeredCount: (info, attestationExpiry, now) => call(() => core().registeredCount(JSON.stringify(info), big(attestationExpiry), big(now))),
    /** A `ChainSnapshot` from the records of WP-E's bulk feeds read at one pinned height. */
    snapshotFromFeeds: (records) => JSON.parse(call(() => core().snapshotFromFeeds(JSON.stringify(records)))),
    /**
     * E-18a: the text the wallet signs for a wallet account of `scheme` (one text; it names the vault origin,
     * the deployment, the wallet and the scheme's version). For EIP-191 `address` may be 0x… or the THORChain
     * form of the same 20 bytes (the app's EIP-712 account); the text carries the EIP-55 address.
     */
    walletMessage: (scheme, origin, deployment, address) => call(() => core().walletMessage(scheme, origin, JSON.stringify(deployment), address)),
    /**
     * Errata E-69: a wallet account's home, the wallet's own THORChain address (ADR-036 the signer's address,
     * EIP-191 the THORChain form of the same 20 bytes; `address` may be 0x… or that form). The settings of
     * `Vault.fromWallet` carry it as `home`; any other home is refused (`WALLET_HOME`). A rescue can be another wallet.
     */
    walletHome: (scheme, deployment, address) => call(() => core().walletHome(scheme, JSON.stringify(deployment), address)),
    /**
     * Errata E-69 (R3-E1): the text a rescue wallet signs to become the rescue of the wallet account with fingerprint
     * `account` (hex) on `deployment` ("Sign with your rescue wallet"; `scheme` the rescue wallet's).
     */
    rescueConsentMessage: (deployment, account, scheme, rescue) => call(() => core().rescueConsentMessage(JSON.stringify(deployment), account, scheme, rescue)),
    /**
     * Errata E-69 (R4-E1): the text the HOME wallet (`homeScheme`, `home`) of the wallet account with fingerprint
     * `account` signs to confirm `rescue` ("Confirm your rescue in your wallet": its signing window shows the rescue).
     */
    rescueBindingMessage: (deployment, account, homeScheme, home, rescue) => call(() => core().rescueBindingMessage(JSON.stringify(deployment), account, homeScheme, home, rescue)),
    /**
     * E-18a: a Transition (K contract) wallet account's K-path keys and fingerprint, from the wallet's answer(s)
     * for `walletMessage("transition-…", origin, kDeployment, address)`. `S_w` stays in WebAssembly.
     */
    transitionWalletKeys: (kDeployment, signIn) => JSON.parse(call(() => core().transitionWalletKeys(JSON.stringify(kDeployment), signInJson(signIn)))),
    /**
     * E-18b: what the UI asks the primary passkey's PRF for (WebAuthn `prf: { eval: { first: salt } }`, hex), from
     * a wallet sign-in: computed from `S_w` and the deployment, before `d` exists, the same on every device.
     */
    walletPasskeySalt: (deployment, signIn) => call(() => core().walletPasskeySalt(JSON.stringify(deployment), signInJson(signIn))),
    /** E-18: the ADR-036 sign document of that text (what `signArbitrary` signs). */
    walletSignDoc: (address, message) => core().walletSignDoc(address, message),
    /** WP-A's statement document of a proof job (secret: it carries the witness). */
    proverDocument: (job) => JSON.parse(call(() => core().proverDocument(job))),
    /** Check WP-A's prover output against the job; returns the §5.8 envelope. */
    acceptProverOutput: (job, out) => call(() => core().acceptProverOutput(job, out.vkId, out.publicInputs, out.piDigest, out.envelope)),
    /** E-15: the transaction size of a message (at most 1,000,000 bytes). */
    txSize: (msg) => call(() => core().txSize(JSON.stringify(msg))),
    /** §9.2: a withdrawal or funding above 80 % of `eff(V2)` also sends a second proof. */
    secondProofRequired: (amount, v2) => call(() => core().secondProofRequired(amount, v2)),
    /** E-15: parts that need no second proof (when the device cannot make one and no native prover helps). */
    splitBelowSecondProof: (amount, v2, maxParts = 8) => JSON.parse(call(() => core().splitBelowSecondProof(amount, v2, maxParts))),
    /** C5: two snapshots from independent sources must agree exactly at one height (throws `REPLAY`). */
    crossCheckSnapshots: (a, b) => call(() => core().crossCheckSnapshots(JSON.stringify(a), JSON.stringify(b))),
    /** The local-chain mock prover (refuses chain ids without "local"). */
    mockProve: (job) => call(() => core().mockProve(typeof job === "string" ? job : JSON.stringify(job))),
};
/** An unlocked vault (one unlock per session, errata E-4). Lives in the vault Worker. */
export class Vault {
    w;
    constructor(w) {
        this.w = w;
    }
    static create(config) {
        return new Vault(call(() => core().WasmVault.create(JSON.stringify(config))));
    }
    static restoreFromPhrase(phrase, config) {
        return new Vault(call(() => core().WasmVault.restoreFromPhrase(phrase, JSON.stringify(config))));
    }
    static restoreFromBackup(file, passphrase) {
        return new Vault(call(() => core().WasmVault.restoreFromBackup(file, passphrase)));
    }
    static unlockPrf(blob, prf, config) {
        return new Vault(call(() => core().WasmVault.unlockPrf(blob, prf, JSON.stringify(config))));
    }
    static unlockPassphrase(blob, passphrase, config) {
        return new Vault(call(() => core().WasmVault.unlockPassphrase(blob, passphrase, JSON.stringify(config))));
    }
    static unlockPrfAndPin(blob, prf, pin, config) {
        return new Vault(call(() => core().WasmVault.unlockPrfAndPin(blob, prf, pin, JSON.stringify(config))));
    }
    static fromPairing(qr, fetchedBlob, config) {
        return new Vault(call(() => core().WasmVault.fromPairing(qr, fetchedBlob ?? undefined, JSON.stringify(config))));
    }
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
    static fromWallet(p) {
        const prf = p.passkeyPrf === undefined ? undefined : typeof p.passkeyPrf === "string" ? p.passkeyPrf : toHex(p.passkeyPrf);
        return new Vault(call(() => core().WasmVault.fromWallet(JSON.stringify(p.deployment), signInJson(p), p.level, prf, JSON.stringify(p.config))));
    }
    /** E-18b: what this session's passkey is to the account on `dep` (sync first). */
    passkeyCheck(dep) {
        return call(() => this.w.passkeyCheck(dep));
    }
    /**
     * E-18b: where an account switch (wallet only → passkey) stands (sync first). `unfinished`: a passkey
     * generation is on chain and wallet-only notes are left (an interrupted switch); `resumable_here`: this is
     * a wallet-only session, so `beginUpgradeToPasskey` with the same passkey continues it (a passkey session
     * opens the wallet-only level from the same wallet sign-in for that).
     */
    switchState(dep) {
        return JSON.parse(call(() => this.w.switchState(dep)));
    }
    /**
     * E-18b: upgrade a wallet-only account to the passkey level, a private re-note: `{ vault, steps }` like
     * `beginUpgradeToPhrase` (the new vault writes its header; each `move_note` step funds a fresh account of it).
     * Sync this vault first: an interrupted switch resumes with the same passkey (no `write_new_header` step
     * when its generation is on chain; only the notes still in the wallet-only generation move); another
     * passkey is refused (`WALLET_ACCOUNT`).
     */
    beginUpgradeToPasskey(dep, passkeyPrf) {
        const prf = typeof passkeyPrf === "string" ? passkeyPrf : toHex(passkeyPrf);
        const h = call(() => this.w.beginUpgradeToPasskey(dep, prf));
        const steps = JSON.parse(h.steps());
        const warning = h.viewKeyWarning?.() ?? undefined;
        const history = h.historyWarning?.() ?? undefined;
        return { vault: new Vault(call(() => h.takeNewVault())), steps, ...(warning ? { view_key_warning: warning } : {}), ...(history ? { history_warning: history } : {}) };
    }
    /** E-18b "bring everything home", the notes (one FAST withdrawal home each; prove, release, relay). */
    planHomeWithdrawals(dep, denom, opts) {
        return JSON.parse(call(() => this.w.planHomeWithdrawals(dep, denom ?? undefined, JSON.stringify(opts))));
    }
    /**
     * Errata E-67 (2), review F3: for a lost or compromised home, every note moved to its generation's rescue with a
     * FAST withdrawal (`home_only`; prove, release, relay each): the default over the proof-free exit to rescue.
     */
    planRescueWithdrawals(dep, denom, opts) {
        return JSON.parse(call(() => this.w.planRescueWithdrawals(dep, denom ?? undefined, JSON.stringify(opts))));
    }
    /** E-18b "bring everything home", the Spending accounts (a safe-key sweep home each; relay). */
    planHomeSweeps(dep, expiryHeight) {
        return JSON.parse(call(() => this.w.planHomeSweeps(dep, big(expiryHeight))));
    }
    /** E-18a: this wallet account's fingerprint (not secret): keep it to open the account later with one signature. */
    walletFingerprint() {
        return call(() => this.w.walletFingerprint());
    }
    /**
     * E-18a: the K contract's keys of this phrase account on a K deployment (the Transition profile): S stays
     * inside. A wallet account uses `util.transitionWalletKeys` with a Transition scheme (`WALLET_ACCOUNT` here).
     */
    transitionKeys(kDeployment) {
        return JSON.parse(call(() => this.w.transitionKeys(JSON.stringify(kDeployment))));
    }
    /** E-18: `{ kind: "phrase" }` or `{ kind: "wallet", scheme, origin, address, deployment_id, two_key }`. */
    accountKind() {
        return JSON.parse(call(() => this.w.accountKind()));
    }
    /** E-18: upgrade a wallet account to a phrase account: a private move, walked like a phrase rotation. */
    beginUpgradeToPhrase(dep) {
        const h = call(() => this.w.beginUpgradeToPhrase(dep));
        const steps = JSON.parse(h.steps());
        const warning = h.viewKeyWarning?.() ?? undefined;
        const history = h.historyWarning?.() ?? undefined;
        return { vault: new Vault(call(() => h.takeNewVault())), steps, ...(warning ? { view_key_warning: warning } : {}), ...(history ? { history_warning: history } : {}) };
    }
    // ---- secrets out (vault UI only)
    phrase() {
        return call(() => this.w.phrase());
    }
    phraseChallenge() {
        return JSON.parse(call(() => this.w.phraseChallenge()));
    }
    confirmPhraseWords(answers) {
        return call(() => this.w.confirmPhraseWords(JSON.stringify(answers)));
    }
    confirmBackupFile(file, passphrase) {
        call(() => this.w.confirmBackupFile(file, passphrase));
    }
    get backupConfirmed() {
        return this.w.backupConfirmed();
    }
    /**
     * Errata E-63: open a passkey backup (`backupFile` with `includeDeviceFactor` at the wallet + passkey level) of
     * this account: its `d` reaches the lost passkey's exit addresses (keying `s_d_backup`). `false`: this session's own `d`.
     */
    restorePasskeyBackup(file, passphrase) {
        return call(() => this.w.restorePasskeyBackup(file, passphrase));
    }
    backupFile(passphrase, opts = {}) {
        return call(() => this.w.backupFile(passphrase, opts.desktop ?? false, opts.includeDeviceFactor ?? false));
    }
    sealDevicePrf(prf) {
        return call(() => this.w.sealDevicePrf(prf));
    }
    sealDevicePassphrase(passphrase) {
        return call(() => this.w.sealDevicePassphrase(passphrase));
    }
    sealDevicePrfAndPin(prf, pin) {
        return call(() => this.w.sealDevicePrfAndPin(prf, pin));
    }
    pairingOffer() {
        return JSON.parse(call(() => this.w.pairingOffer()));
    }
    restoredCounters() {
        return JSON.parse(call(() => this.w.restoredCounters()));
    }
    applyRestoredCounters() {
        this.w.applyRestoredCounters();
    }
    get hasDeviceFactor() {
        return this.w.hasDeviceFactor();
    }
    newDeviceFactor() {
        call(() => this.w.newDeviceFactor());
    }
    setConfirmPolicy(p) {
        call(() => this.w.setConfirmPolicy(p));
    }
    config() {
        return JSON.parse(call(() => this.w.config()));
    }
    /** This device's id in a deployment (hex id), or without one the id the session was opened with. */
    deviceId(dep) {
        return call(() => this.w.deviceId(dep ?? undefined));
    }
    /**
     * Change home and rescue (`rescue: null` clears it) while the current header is only planned. Once it is
     * committed both are fixed in it (§3.7): `STATE`; then a new generation (`beginGenerationRotation`) does it.
     * Checked as at creation (`INVALID_ADDRESS`).
     */
    setDestinations(p) {
        call(() => this.w.setDestinations(p.home, p.rescue ?? undefined));
    }
    /**
     * Pass 11b (errata E-34): the home and rescue of an older header generation, on a device restored with
     * another home (the sync warns while a generation that holds notes has none); they must hash to its `Hd`,
     * `Rd`. A redirect home or veto home of a payout from that generation's notes needs them.
     */
    setGenerationDestinations(dep, generation, home, rescue) {
        call(() => this.w.setGenerationDestinations(dep, generation, home, rescue ?? undefined));
    }
    // ---- deployments, headers, sync
    attach(d) {
        return call(() => this.w.attach(JSON.stringify(d)));
    }
    /** The current generation's header plan (what its commit and reveal carry), without the chain checks. */
    headerPlan(dep) {
        return JSON.parse(call(() => this.w.headerPlan(dep)));
    }
    /**
     * C4: where the current header generation stands and the next step: `sync` (read the chain first),
     * `commit`, `reveal`, `done` (deposits open) or `blocked` (with `reason`). `writeHeader` walks it.
     */
    headerReport(dep) {
        return JSON.parse(call(() => this.w.headerReport(dep)));
    }
    /**
     * C4: `header_commit` of the current generation. `NEEDS_SYNC` before the chain was read; `STATE` when the
     * chain shows the generation written already (nothing to write: never send it again).
     */
    headerCommitMsg(dep) {
        return JSON.parse(call(() => this.w.headerCommitMsg(dep)));
    }
    /**
     * C4: `header_reveal`, after the commit was seen included (`headerCommitted`; `STATE` otherwise) and a
     * sync newer than it (`NEEDS_SYNC` otherwise).
     */
    headerRevealMsg(dep) {
        return JSON.parse(call(() => this.w.headerRevealMsg(dep)));
    }
    /** The header commit was included at `height` (call it only after inclusion: the reveal needs it). */
    headerCommitted(dep, height) {
        call(() => this.w.headerCommitted(dep, big(height)));
    }
    /** The chain refused the reveal with `UnknownCommitment` (the commit is not on chain): commit again. */
    headerCommitLost(dep) {
        call(() => this.w.headerCommitLost(dep));
    }
    /**
     * Sync from a snapshot (C5). `opts.deep` scans far beyond the spec's gaps (a restore that misses money);
     * notes found beyond them show `reachable: false` in `notes()` and should be moved (fund a Spending
     * account and return) so the phrase alone finds them.
     */
    sync(dep, snapshot, opts = {}) {
        const snap = typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot);
        if (opts.deep || opts.min_height !== undefined)
            call(() => this.w.syncWith(dep, snap, syncOptionsJson(opts)));
        else
            call(() => this.w.sync(dep, snap));
    }
    /**
     * Errata E-38 (C5): sync from two snapshots of independent sources at one height; they must be equal
     * (`REPLAY` otherwise, and nothing changes). `sync` with one snapshot is a degraded sync: `syncStatus`
     * and a warning say so.
     */
    syncChecked(dep, a, b, opts = {}) {
        const sa = typeof a === "string" ? a : JSON.stringify(a);
        const sb = typeof b === "string" ? b : JSON.stringify(b);
        call(() => this.w.syncChecked(dep, sa, sb, syncOptionsJson(opts)));
    }
    /** Errata E-38: this session's last sync (`sources`: 2 cross-checked, 1 one source, 0 none). */
    syncStatus(dep) {
        return JSON.parse(call(() => this.w.syncStatus(dep)));
    }
    balances(dep) {
        return JSON.parse(call(() => this.w.balances(dep)));
    }
    notes(dep) {
        return JSON.parse(call(() => this.w.notes(dep)));
    }
    accounts(dep) {
        return JSON.parse(call(() => this.w.accounts(dep)));
    }
    warnings(dep) {
        return JSON.parse(call(() => this.w.warnings(dep)));
    }
    // ---- deposits and private actions
    prepareDeposit(dep, depositor, denom, amount) {
        return JSON.parse(call(() => this.w.prepareDeposit(dep, depositor, denom, amount)));
    }
    /**
     * Check the node's attestation and build the wallet's `deposit` message. The prepared deposit keeps its
     * counter until a sync is past the attestation's expiry (errata E-32): `abandonDeposit` when the wallet did
     * not send it.
     */
    finishDeposit(dep, plan, att, now, attestVk, registeredCount) {
        return JSON.parse(call(() => this.w.finishDeposit(dep, JSON.stringify(plan), JSON.stringify(att), big(now), attestVk, registeredCount)));
    }
    /** A prepared deposit the wallet did not send (cancelled, refused to sign): its counter is free again. */
    abandonDeposit(dep, inner) {
        return call(() => this.w.abandonDeposit(dep, inner));
    }
    /**
     * One or two input notes of one header generation covering `amount` (vault-core `select_inputs`);
     * `deviceOnly` keeps to the generations this device holds `d` for (a third-party withdrawal, a funding:
     * the other generations pay home or rescue only, spec §3.6).
     */
    selectInputs(dep, denom, amount, deviceOnly = false) {
        return JSON.parse(call(() => this.w.selectInputs(dep, denom, amount, deviceOnly)));
    }
    /**
     * Errata E-68 (13) R2-L4: the inputs of a funding of a Spending account (`selectInputs` with `deviceOnly`), skipping
     * the notes a history file's holder can follow (merge those first, `historyMovePlan`).
     */
    selectFundingInputs(dep, denom, amount) {
        return JSON.parse(call(() => this.w.selectFundingInputs(dep, denom, amount)));
    }
    prepareSpend(dep, inputs, amount, kind, opts) {
        return JSON.parse(call(() => this.w.prepareSpend(dep, JSON.stringify(inputs), amount, JSON.stringify(kind), JSON.stringify(opts))));
    }
    /** The proof job with the witness: only for the vault's prover Worker. */
    proofJob(actionId) {
        return JSON.parse(call(() => this.w.proofJob(big(actionId))));
    }
    proofJobJson(actionId) {
        return call(() => this.w.proofJob(big(actionId)));
    }
    /** The second proof's job (E-15: FAST2 at 0x0204); fresh randomness per call; available after release. */
    secondProofJob(actionId) {
        return JSON.parse(call(() => this.w.secondProofJob(big(actionId))));
    }
    secondProofJobJson(actionId) {
        return call(() => this.w.secondProofJob(big(actionId)));
    }
    secondProofDone(actionId) {
        call(() => this.w.secondProofDone(big(actionId)));
    }
    secondProofsDue() {
        return JSON.parse(call(() => this.w.secondProofsDue()));
    }
    /** Fresh randomness for a prepared action's proof (after `MESSAGE_TOO_LARGE`). */
    refreshProof(actionId) {
        call(() => this.w.refreshProof(big(actionId)));
    }
    secondProofBody(actionId, envelope) {
        return JSON.parse(call(() => this.w.secondProofBody(big(actionId), envelope)));
    }
    /** E-4: silent unless the owner opted into confirmations (then CONFIRMATION_REQUIRED). */
    release(actionId, envelope) {
        return JSON.parse(call(() => this.w.release(big(actionId), envelope)));
    }
    abandon(actionId) {
        call(() => this.w.abandon(big(actionId)));
    }
    /**
     * C3: free the notes (`handles`) a released action holds after its relay failed, so they can be proved
     * again for another node. `refused`: the node refused the relay (nothing was submitted); `expired`: only
     * once a sync has passed the action's expiry height (a sync frees those by itself too; earlier is
     * `STATE`). A note of a prepared, unreleased action is `STATE`: `abandon` that action. Returns the freed
     * nullifiers.
     */
    expireReservation(dep, handles, why) {
        return JSON.parse(call(() => this.w.expireReservation(dep, JSON.stringify(handles), why)));
    }
    /** C3: `expireReservation` for every input of a released action of this session, by its id. */
    expireAction(actionId, why) {
        return JSON.parse(call(() => this.w.expireAction(big(actionId), why)));
    }
    confirmationRequest(actionId) {
        const r = call(() => this.w.confirmationRequest(big(actionId)));
        return r ? JSON.parse(r) : null;
    }
    confirmPasskey(actionId, challengeHex) {
        call(() => this.w.confirmPasskey(big(actionId), challengeHex));
    }
    confirmPin(actionId, pin) {
        call(() => this.w.confirmPin(big(actionId), pin));
    }
    /** E-13: announce a withdrawal that goes out in parts; one card and (if opted in) one confirmation. */
    beginWithdrawal(dep, denom, parts, fee, expiryHeight) {
        return JSON.parse(call(() => this.w.beginWithdrawal(dep, denom, JSON.stringify(parts), JSON.stringify(fee), big(expiryHeight))));
    }
    cancelWithdrawal(withdrawalId) {
        call(() => this.w.cancelWithdrawal(big(withdrawalId)));
    }
    withdrawals() {
        return JSON.parse(call(() => this.w.withdrawals()));
    }
    authorizations() {
        return JSON.parse(call(() => this.w.authorizations()));
    }
    pendingActions() {
        return JSON.parse(call(() => this.w.pendingActions()));
    }
    // ---- Spending accounts
    newAccount(dep, scope, policy, loosenDelay) {
        return JSON.parse(call(() => this.w.newAccount(dep, JSON.stringify(scope), policy ? JSON.stringify(policy) : undefined, loosenDelay === undefined ? undefined : big(loosenDelay))));
    }
    accountForTask(dep, task) {
        return JSON.parse(call(() => this.w.accountForTask(dep, task)));
    }
    createAccountMsg(dep, n) {
        return JSON.parse(call(() => this.w.createAccountMsg(dep, n)));
    }
    /**
     * A signed Spending call. Errata E-39: under an opted-in confirmation policy a full-key call that moves
     * value where the policy covers throws `CONFIRMATION_REQUIRED`; use `prepareCall`, confirm it like an
     * action (`confirmationRequest`, `confirmPasskey` / `confirmPin`) and `releaseCall`.
     */
    accountCall(dep, n, key, calls, fees, expiry, feeAuthorization) {
        return JSON.parse(call(() => this.w.accountCall(dep, n, key, JSON.stringify(calls), JSON.stringify(fees), feeAuthorization ? JSON.stringify(feeAuthorization) : undefined, big(expiry))));
    }
    /**
     * Errata E-39: a Spending call checked and carded, not yet signed (`abandon(call_id)` drops it). `quotes`
     * (pass 11b): the platform's swap quotes; under an opted-in policy a swap to the account itself asks unless
     * its limit is within the tolerance (3 %) of one of the same asset, coin and amount (none: every swap asks).
     */
    prepareCall(dep, n, key, calls, fees, expiry, feeAuthorization, quotes) {
        return JSON.parse(call(() => this.w.prepareCall(dep, n, key, JSON.stringify(calls), JSON.stringify(fees), feeAuthorization ? JSON.stringify(feeAuthorization) : undefined, big(expiry), quotes ? JSON.stringify(quotes) : undefined)));
    }
    /** Errata E-39: sign a prepared call (after its confirmation when it needs one); logged in `authorizations()`. */
    releaseCall(callId) {
        return JSON.parse(call(() => this.w.releaseCall(big(callId))));
    }
    /**
     * Errata E-28: would the proxy accept `calls` from the account's safe key? Only registered close variants
     * whose body the rule allows (`rules`: the proxy's `close_variants` entries, each `{contract, variant,
     * body?}`; a `code:<id>` rule expanded to the contracts it means). Throws `POLICY_REFUSED` with
     * `SafeKeyNotAllowed: …` otherwise. A lint before `accountCall(…, "safe", …)`; the proxy stays the authority.
     */
    checkSafeClose(calls, relayerFee, rules) {
        call(() => this.w.checkSafeClose(JSON.stringify(calls), relayerFee ? JSON.stringify(relayerFee) : undefined, JSON.stringify(rules)));
    }
    prepareReturn(dep, n, coins, expiry) {
        return JSON.parse(call(() => this.w.prepareReturn(dep, n, JSON.stringify(coins), big(expiry))));
    }
    finishReturn(dep, plan, by, att, now, attestVk, registeredCount) {
        return JSON.parse(call(() => this.w.finishReturn(dep, JSON.stringify(plan), by, att ? JSON.stringify(att) : undefined, big(now), attestVk, registeredCount)));
    }
    standingOrder(dep, n, key, orderId, minAmounts, maxReturns, orderExpiry, expiry) {
        return JSON.parse(call(() => this.w.standingOrder(dep, n, key, orderId, JSON.stringify(minAmounts), maxReturns, big(orderExpiry), big(expiry))));
    }
    refreshSlots(dep, n, expiry) {
        return JSON.parse(call(() => this.w.refreshSlots(dep, n, big(expiry))));
    }
    sweepHome(dep, n, key, to, destGeneration, expiry) {
        return JSON.parse(call(() => this.w.sweepHome(dep, n, key, to, destGeneration, big(expiry))));
    }
    /**
     * Errata E-25: `requestHex` is the vetoed request's pi_digest (its `slows` record, or the rotation step's
     * `request`). Errata E-34: a veto home goes to the home of the request's note's generation and, with
     * `mode` `"bunker_k"`, carries the destination proof the proxy requires there (to rescue if one is set).
     * A veto home publishes `hsalt` (errata E-33: rotate the phrase afterwards).
     */
    veto(dep, nullifierHex, requestHex, home, expiry, mode = "normal") {
        return JSON.parse(call(() => this.w.veto(dep, nullifierHex, requestHex, home, big(expiry), mode)));
    }
    /**
     * Errata E-34: the queued payouts of this vault's spends (last sync). `to_own: false` pays a recipient:
     * one the owner did not make is a withdrawal by someone holding S and d: `queueRedirectHome` it before it
     * pays (home wins, D12). Pass 11b: `authorized_here` says this vault authorized it; warn only when it and
     * `to_own` are both false.
     */
    myQueueItems(dep) {
        return JSON.parse(call(() => this.w.myQueueItems(dep)));
    }
    /**
     * Errata E-34: `queue_redirect_home` for one of `myQueueItems`' items, to the home of the spent notes'
     * generation; with `mode` `"bunker_k"` it carries the destination proof (to rescue if one is set). It
     * publishes `lsalt` or `hsalt` (errata E-33: rotate the phrase afterwards).
     */
    queueRedirectHome(dep, item, mode = "normal") {
        return JSON.parse(call(() => this.w.queueRedirectHome(dep, JSON.stringify(item), mode)));
    }
    // ---- exits (E-9), rotation (E-12), privacy
    /** Errata E-34: `to` pins the notes' exit destination (E-29, E-31a); without it, no pin. */
    exitLock(dep, handles, to) {
        return JSON.parse(call(() => this.w.exitLock(dep, JSON.stringify(handles), to)));
    }
    planExit(dep, handles, to, opts = {}) {
        return JSON.parse(call(() => this.w.planExit(dep, JSON.stringify(handles), to, opts.chunk ?? 25, opts.revealAncestry ?? 32, opts.mode ?? "normal")));
    }
    markAudited(dep, indices) {
        call(() => this.w.markAudited(dep, JSON.stringify(indices)));
    }
    scheduleLineageAudits(dep, mode, proactive = false, chunk = 25) {
        return JSON.parse(call(() => this.w.scheduleLineageAudits(dep, mode, proactive, chunk)));
    }
    lineageReport(dep) {
        return JSON.parse(call(() => this.w.lineageReport(dep)));
    }
    rotationAdvice(dep) {
        return JSON.parse(call(() => this.w.rotationAdvice(dep)));
    }
    // ---- view keys (errata E-66): the vault UI channel only
    /**
     * What a view key with `options` names and reveals, what it can never do, the warnings, and its fingerprint.
     * It reads the chain first (errata E-66 (3) fix): `a` and `b` two independent sources at one height (C5; `b`
     * null: one source), `opts.min_height` the tip the platform read itself (required).
     */
    viewKeyDisclosure(dep, options, a, b, opts) {
        const sa = typeof a === "string" ? a : JSON.stringify(a);
        const sb = b === null ? undefined : typeof b === "string" ? b : JSON.stringify(b);
        return JSON.parse(call(() => this.w.viewKeyDisclosure(dep, JSON.stringify(options), sa, sb, syncOptionsJson(opts))));
    }
    /**
     * The view-key file, only with the fingerprint its disclosure showed, at the height that disclosure read (no
     * sync since; `CONFIRMATION_REQUIRED` otherwise).
     */
    exportViewKey(dep, options, fingerprint) {
        return JSON.parse(call(() => this.w.exportViewKey(dep, JSON.stringify(options), fingerprint)));
    }
    /** The records of the view keys exported for this account. */
    viewKeyExports(dep) {
        return JSON.parse(call(() => this.w.viewKeyExports(dep)));
    }
    // ---- history files (errata E-68): the vault UI channel only
    /**
     * What a history file with `options` lists and shows, what its holder can never do, the warnings, and its
     * fingerprint. It reads the chain first: `a` and `b` two independent sources at one height (C5; `b` null: one
     * source), `opts.min_height` the tip the platform read itself (required), `blockHashes` the header hash of the block
     * at the cut height from each source the platform read it from (one or two, hex).
     */
    historyDisclosure(dep, options, a, b, opts, blockHashes, activity = []) {
        const sa = typeof a === "string" ? a : JSON.stringify(a);
        const sb = b === null ? undefined : typeof b === "string" ? b : JSON.stringify(b);
        const hashes = JSON.stringify(blockHashes.map((h) => h.toLowerCase()));
        return JSON.parse(call(() => this.w.historyDisclosure(dep, JSON.stringify(options), sa, sb, syncOptionsJson(opts), hashes, JSON.stringify(activity))));
    }
    /** Errata E-68 (13) R2-L6: the heights `[lo, hi]` whose header hashes the platform reads for a history cut at `cut`. */
    historyWindow(dep, cut) {
        const [lo, hi] = JSON.parse(call(() => this.w.historyWindow(dep, big(cut))));
        return [Number(lo), Number(hi)];
    }
    /** The history file of the last disclosure, only with its fingerprint and while no sync happened since (`CONFIRMATION_REQUIRED`). */
    exportHistory(dep, fingerprint) {
        return JSON.parse(call(() => this.w.exportHistory(dep, fingerprint)));
    }
    /** The records of the history files exported for this account. */
    historyExports(dep) {
        return JSON.parse(call(() => this.w.historyExports(dep)));
    }
    /** Errata E-68 (12) L-1: the history files out whose held notes are unspent, and those notes. */
    historyNotesUnspent(dep) {
        const [files, notes] = JSON.parse(call(() => this.w.historyNotesUnspent(dep)));
        return { files, notes };
    }
    /** Errata E-68 (12) L-1: the move-first path (merge each pair, spend each single once). */
    historyMovePlan(dep) {
        return JSON.parse(call(() => this.w.historyMovePlan(dep)));
    }
    /**
     * Errata E-68 (12) L-1, (13) Info 7: acknowledge the exposure for the one message `action` names (an exit of these
     * notes to this destination, the lineage audits, a veto home of this request, a redirect home of this queue item); a
     * build that fails keeps it.
     */
    acknowledgeHistoryExposure(dep, action) {
        return JSON.parse(call(() => this.w.acknowledgeHistoryExposure(dep, JSON.stringify(action))));
    }
    /**
     * E-12: start a phrase rotation; returns the new vault and the steps (veto, new header, moves, sweeps).
     * `view_key_warning` (errata E-66 (5)(b), (8), view-key audit run-1 M4): set when a view key of this account was
     * given out: its holder will see where the moved value lands. Show it before the move.
     */
    beginPhraseRotation(dep) {
        const h = call(() => this.w.beginPhraseRotation(dep));
        const steps = JSON.parse(h.steps());
        const warning = h.viewKeyWarning?.() ?? undefined;
        const history = h.historyWarning?.() ?? undefined;
        return { vault: new Vault(call(() => h.takeNewVault())), steps, ...(warning ? { view_key_warning: warning } : {}), ...(history ? { history_warning: history } : {}) };
    }
    rotationMoveNote(newVault, dep, handle, opts) {
        return JSON.parse(call(() => this.w.rotationMoveNote(newVault.w, dep, handle, JSON.stringify(opts))));
    }
    beginGenerationRotation(dep, opts) {
        return call(() => this.w.beginGenerationRotation(dep, opts.home, opts.rescue, opts.clearRescue ?? false, opts.newDevice ?? false));
    }
    freshExitAddress(dep) {
        return call(() => this.w.freshExitAddress(dep));
    }
    /** Errata E-61: the exit-address scan (every keying this session derives, `gap` indices past the last issued). */
    exitAddresses(dep, gap) {
        return JSON.parse(call(() => this.w.exitAddresses(dep, gap)));
    }
    noteExitUsed(dep, n, keying) {
        call(() => this.w.noteExitUsed(dep, n, keying));
    }
    /** Errata E-61, "Send home": the signed send (`tx_bytes` base64) of an exit address's coins to home. */
    exitSendHome(dep, address, req) {
        return JSON.parse(call(() => this.w.exitSendHome(dep, address, JSON.stringify(req))));
    }
    /** Errata E-62: the restart's state. */
    restartReport(dep) {
        return JSON.parse(call(() => this.w.restartReport(dep)));
    }
    restartWithThisPasskey(dep) {
        return JSON.parse(call(() => this.w.restartWithThisPasskey(dep)));
    }
    restartSendHome(dep, denom, opts) {
        return JSON.parse(call(() => this.w.restartSendHome(dep, denom ?? undefined, JSON.stringify(opts))));
    }
    restartMoveAccount(dep) {
        return JSON.parse(call(() => this.w.restartMoveAccount(dep)));
    }
    prepareRestartMove(dep, cm, opts) {
        return JSON.parse(call(() => this.w.prepareRestartMove(dep, cm, JSON.stringify(opts))));
    }
    planPrivateExit(dep, amount, maxParts, now, sendNow = false) {
        return JSON.parse(call(() => this.w.planPrivateExit(dep, amount, maxParts, big(now), sendNow)));
    }
    // ---- agents (owner side)
    delegate(dep, n, agentVk, policy, delegationExpiry, canReturn, now, expiry) {
        return JSON.parse(call(() => this.w.delegate(dep, n, agentVk, JSON.stringify(policy), big(delegationExpiry), canReturn, big(now), big(expiry))));
    }
    revokeDelegation(dep, n, delegationId, key, expiry) {
        return JSON.parse(call(() => this.w.revokeDelegation(dep, n, delegationId, key, big(expiry))));
    }
    freezeAgents(dep, n, key, expiry) {
        return JSON.parse(call(() => this.w.freezeAgents(dep, n, key, big(expiry))));
    }
    agentSlots(dep, n, count) {
        return JSON.parse(call(() => this.w.agentSlots(dep, n, count)));
    }
    // ---- persistence
    exportState(dep) {
        return call(() => this.w.exportState(dep));
    }
    importState(d, blob) {
        return call(() => this.w.importState(JSON.stringify(d), blob));
    }
    stateBlob(dep, version) {
        return JSON.parse(call(() => this.w.stateBlob(dep, big(version))));
    }
    /** Errata E-68 (13) R2-L2: the id of this account's state blob (`GET /blob/{id}`). */
    stateBlobId(dep) {
        return call(() => this.w.stateBlobId(dep));
    }
    /**
     * Errata E-68 (13) R2-L2: apply a state blob another device wrote (raw bytes; only ever adds: counters, the address
     * book, the published-opening mark, history export records). `REPLAY` below the version floor. Returns its version.
     */
    applyStateBlob(dep, blob) {
        return Number(call(() => this.w.applyStateBlob(dep, blob)));
    }
    /** Errata E-68 (13) R2-L2: the version floor (write floor + 1). */
    stateBlobFloor(dep) {
        return Number(call(() => this.w.stateBlobFloor(dep)));
    }
    /** Errata E-68 (13) R2-L2: a node took the blob of `version`: the floor rises to it. */
    stateBlobWritten(dep, version) {
        call(() => this.w.stateBlobWritten(dep, big(version)));
    }
    /**
     * Errata E-69 (R3-E1): the text the rescue wallet signs to become this wallet account's rescue ("Sign with your
     * rescue wallet"); `scheme` is the rescue wallet's.
     */
    rescueConsentMessage(dep, scheme, rescue) {
        return call(() => this.w.rescueConsentMessage(dep, scheme, rescue));
    }
    /**
     * Errata E-69 (R4-E1): the text this account's own (home) wallet signs to confirm `rescue` ("Confirm your rescue in
     * your wallet": the rescue address shows in its signing window).
     */
    rescueBindingMessage(dep, rescue) {
        return call(() => this.w.rescueBindingMessage(dep, rescue));
    }
    /**
     * Errata E-69 (R3-E1, R4-E1): keep the rescue's consent (both answers, verified now); then set the rescue as usual.
     */
    setRescueConsent(consent) {
        call(() => this.w.setRescueConsent(JSON.stringify(consent)));
    }
    /** Lock: every secret is dropped; afterwards every call answers `LOCKED`. */
    lock() {
        const w = this.w;
        this.w = LOCKED_HANDLE;
        if (w !== LOCKED_HANDLE)
            w.lock();
    }
}
/** The agent side: an agent key and its delegation. Never `S` or `d`. */
export class Agent {
    w;
    constructor(w) {
        this.w = w;
    }
    static generate() {
        return new Agent(call(() => core().WasmAgent.generate()));
    }
    static open(file, passphrase) {
        return new Agent(call(() => core().WasmAgent.open(file, passphrase)));
    }
    get vk() {
        return this.w.vk();
    }
    seal(passphrase) {
        return call(() => this.w.seal(passphrase));
    }
    setDelegation(delegation, destinations, slots = []) {
        call(() => this.w.setDelegation(JSON.stringify(delegation), JSON.stringify(destinations), JSON.stringify(slots)));
    }
    delegation() {
        return JSON.parse(call(() => this.w.delegation()));
    }
    check(calls, relayerFee, now) {
        return JSON.parse(call(() => this.w.check(JSON.stringify(calls), relayerFee ? JSON.stringify(relayerFee) : undefined, big(now))));
    }
    execute(calls, fees, now) {
        return JSON.parse(call(() => this.w.execute(JSON.stringify(calls), JSON.stringify(fees), big(now))));
    }
    pay(destId, denom, amount, fees, now) {
        return JSON.parse(call(() => this.w.pay(destId, denom, amount, JSON.stringify(fees), big(now))));
    }
    /** A THORChain swap back to the account itself (D16). */
    swapToSelf(denom, asset, amount, toAsset, minOut, fees, now) {
        return JSON.parse(call(() => this.w.swapToSelf(denom, JSON.stringify(asset), amount, toAsset, minOut, JSON.stringify(fees), big(now))));
    }
    revokeSelf(now) {
        return JSON.parse(call(() => this.w.revokeSelf(big(now))));
    }
    agentReturn(coins, now) {
        return JSON.parse(call(() => this.w.agentReturn(JSON.stringify(coins), big(now))));
    }
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
export async function writeHeader(v, dep, io, maxSteps = 16) {
    let lastNext = null;
    for (let i = 0; i < maxSteps; i++) {
        const r = v.headerReport(dep);
        switch (r.next) {
            case "done":
                return r;
            case "blocked":
                throw new VaultError("HEADER_BLOCKED", r.reason ?? "this session writes no header on this account");
            case "sync":
                if (lastNext === "sync" && io.pause)
                    await io.pause();
                v.sync(dep, await io.readSnapshot());
                break;
            case "commit": {
                const { height } = await io.submit(v.headerCommitMsg(dep));
                v.headerCommitted(dep, height);
                v.sync(dep, await io.readSnapshot());
                break;
            }
            case "reveal":
                try {
                    await io.submit(v.headerRevealMsg(dep));
                }
                catch (e) {
                    const msg = asVaultError(e).message;
                    // the commit is not on chain (a reset local chain, a commit recorded as landed that never did):
                    // commit again; another header took the number meanwhile: the next sync moves the plan on
                    if (/UnknownCommitment/.test(msg))
                        v.headerCommitLost(dep);
                    else if (!/HeaderExists|HeaderFinal/.test(msg))
                        throw e;
                }
                v.sync(dep, await io.readSnapshot());
                break;
        }
        lastNext = r.next;
    }
    const r = v.headerReport(dep);
    throw new VaultError("HEADER_NOT_WRITTEN", `the header is not written yet (next: ${r.next}${r.reason ? `, ${r.reason}` : ""}): try again shortly`);
}
