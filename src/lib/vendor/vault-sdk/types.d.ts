export type Hex32 = string;
export type Amount = string;
export interface VaultConfig {
    home: string;
    rescue: string | null;
    slow_class: number;
    /** E-4: "off" (default), "third_party" or "all_withdrawals". */
    confirm?: ConfirmPolicy;
    address_book?: Record<string, string>;
    /** E-18: set by the vault (`Vault.fromWallet`); a phrase account when absent. */
    account?: AccountKind;
    /**
     * Errata E-69 (R3-E1, R4-E1): a wallet account's rescue only with the rescue wallet's own consent and the home
     * wallet's confirmation, one entry per rescue wallet (obtained by the vault UI: "Sign with your rescue wallet",
     * `Vault.rescueConsentMessage`; then "Confirm your rescue in your wallet", `Vault.rescueBindingMessage`).
     */
    rescue_consents?: RescueConsent[];
}
/**
 * Errata E-69 (R3-E1, R4-E1): a rescue's consent: the rescue wallet's raw answer for `rescueConsentMessage` and the home
 * wallet's raw answer for `rescueBindingMessage` (hex). Both are required.
 */
export interface RescueConsent {
    scheme: "adr036-secp256k1" | "eip191-secp256k1";
    /** The rescue wallet as it signed (bech32, or 0x… / the THORChain form for EIP-191). */
    address: string;
    /** ADR-036: the rescue wallet's compressed public key (hex); EIP-191: empty. */
    public_key?: string;
    /** ADR-036: 64 bytes r ‖ s (hex); EIP-191: the 65-byte personal_sign answer (hex). */
    signature: string;
    /** Errata E-69 (R4-E1): ADR-036 home: the home wallet's compressed public key (hex); EIP-191 home: empty. */
    home_public_key?: string;
    /** Errata E-69 (R4-E1): the home wallet's answer for `rescueBindingMessage` (hex, as `signature`). */
    home_signature: string;
    /**
     * Errata E-69 (R4-E2): set by the vault when the rescue was removed or replaced: it only recognizes the generations
     * already written with that rescue; a returning rescue needs both signatures again. Never set it yourself.
     */
    retired?: boolean;
}
export type ConfirmPolicy = "off" | "third_party" | "all_withdrawals";
/** `rescue_build`: the proxy runs the exit-only rescue build (errata E-10; E-34: exits to rescue if set). */
export type ChainMode = "normal" | "alarm" | "bunker_k" | "bunker_p" | "rescue_build";
export type KeyKind = "full" | "safe";
/** Errata E-28: what a safe-key close may carry inside its variant (freeze 3 v2.3 `CloseBody`). */
export type CloseBody = {
    empty: Record<string, never>;
} | {
    exact: {
        sha256: string;
    };
} | {
    fields: {
        fields: string[];
    };
};
/** A registered close variant as the client reads it from the proxy (`close_variants`), keyed by contract. */
export interface CloseRule {
    contract: string;
    variant: string;
    /** Omitted: `{empty: {}}` (the strictest rule). */
    body?: CloseBody;
}
/** One slot of a return (`attest_request.slots` of a return plan). */
export interface SlotEntry {
    k: number;
    inner: string;
    denom: string;
    amount: string;
}
export type Destination = "home" | "rescue";
export interface Windows {
    n_forced: number;
    u_notice: number;
    slow_class_blocks: number[];
    loosen_delays: number[];
    max_order_expiry: number;
    max_delegation_expiry: number;
    max_agent_expiry: number;
    header_final_blocks: number;
    queue_delay_default: number;
}
export interface Deployment {
    chain_id: string;
    live_chain_id: string;
    proxy: string;
    hrp: string;
    id: Hex32;
    account_code_checksum: Hex32 | null;
    max_expiry_delta: number;
    windows: Windows;
}
export interface Coin {
    denom: string;
    amount: Amount;
}
export type Call = {
    bank_send: {
        to_address: string;
        amount: Coin[];
    };
} | {
    wasm_execute: {
        contract_addr: string;
        msg: string;
        funds: Coin[];
    };
} | {
    thorchain_deposit: {
        denom: string;
        asset: {
            chain: string;
            symbol: string;
            ticker: string;
            secured: boolean;
        };
        amount: Amount;
        memo: string;
    };
};
/** A proxy execute message (freeze 3): `{ "<variant>": { … } }`. */
export type ExecuteMsg = Record<string, unknown>;
export interface FeeTerms {
    fee_policy_version: number;
    withdraw_fee_bps: number;
}
export interface CallFees {
    relayer_fee: [string, Amount] | null;
    relayer_fee_recipient: string;
    fee_policy_version: number;
    protocol_fee_bps: number;
    protocol_fees: [string, Amount][];
}
export type SpendKind = {
    kind: "withdraw";
    recipient: string;
    home_only: boolean;
} | {
    kind: "fund";
    account: string;
    create: unknown | null;
} | {
    kind: "merge";
} | {
    kind: "slow";
    recipient: string;
};
export type Profile = "P128J3" | "P128U" | "P100U3" | "P128U24" | "Can80";
export interface SpendOptions {
    relayer: string | null;
    expiry_height: number;
    fee: FeeTerms;
    fee_authorization: unknown | null;
    mode: ChainMode;
    l1_profile: Profile;
    v2: Amount | null;
    /** A part of a split withdrawal from `beginWithdrawal` (E-13: confirmed once for all parts). */
    withdrawal?: number | null;
}
export interface ReviewCard {
    kind: string;
    chain_id: string;
    proxy: string;
    denom: string;
    amount: Amount;
    destination: string;
    dest_class: DestClass;
    fee: Amount;
    expiry_height: number;
    /**
     * The parts of a split withdrawal (E-13), or where a Spending call sends value (errata E-39: then each
     * part names its `denom`); absent for a single action.
     */
    parts?: {
        destination: string;
        dest_class: DestClass;
        amount: Amount;
        denom?: string;
        swap?: SwapCheck;
    }[];
}
/**
 * Errata E-39 (pass 11b): a swap to the Spending account itself on its call's card: the memo's target asset,
 * its limit (`"0"`: none or unreadable), the platform's quote it was checked against, and whether the limit
 * is within the tolerance (3 %) of that quote. Under an opted-in policy an unprotected swap asks.
 */
export interface SwapCheck {
    asset: string;
    limit: Amount;
    quote?: Amount;
    protected: boolean;
}
/**
 * Errata E-39 (pass 11b): a quote of a swap from the vault's own platform (`Env.quoteSwap`, read through the
 * nodes; never from the app channel): `expected_out` of swapping `amount` of `denom` into the memo's `asset`
 * (written as the memo writes it), in the target asset's 1e8 units.
 */
export interface SwapQuote {
    asset: string;
    denom: string;
    amount: Amount;
    expected_out: Amount;
}
/** Errata E-39: a Spending call prepared for its confirmation (`prepareCall`). */
export interface CallPlan {
    call_id: number;
    card: ReviewCard;
    needs_confirmation: boolean;
}
/** `own_exit`: a fresh exit address this vault issued (a private exit; not a third party). */
export type DestClass = "home" | "rescue" | "own_account" | "own_exit" | "address_book" | "new";
/** A split withdrawal announced with `beginWithdrawal` (E-13). */
export interface WithdrawalPlan {
    withdrawal_id: number;
    card: ReviewCard;
    needs_confirmation: boolean;
}
export interface SpendPlan {
    action_id: number;
    stmt: "fast1" | "fast2" | "slow1";
    card: ReviewCard;
    needs_confirmation: boolean;
    second_proof: boolean;
    pi_digest: Hex32;
    change_cm: Hex32;
}
/** Proof jobs carry the witness: they go only to the vault's own prover Worker. */
export interface ProofJob {
    stmt: string;
    profile: Profile;
    vk_id: number;
    public_words: number[];
    pi_digest: Hex32;
    chain_id: string;
    [k: string]: unknown;
}
export interface NoteView {
    handle: Hex32;
    denom: string;
    amount: Amount;
    index: number | null;
    status: {
        state: "unspent" | "pending" | "refunded" | "spent";
        [k: string]: unknown;
    };
    generation: number;
    /** This device holds the generation's `d`; without it the note pays home or rescue only (spec §3.6). */
    this_device: boolean;
    /** An input of an action in flight (prepared, or relayed and not yet seen spent): no spend picks it. */
    reserved: boolean;
    /**
     * A restore from the phrase alone finds it (it lies within the spec scan's gaps, §3.12). `false` for a
     * note only this device's records or a deep sync find: move it (fund a Spending account and return).
     */
    reachable: boolean;
    /**
     * Errata E-32: under this vault's own header values that an earlier commitment replaced on chain (within
     * the final window). Only this device's saved state finds it (`reachable` is false): move it.
     */
    superseded: boolean;
    slow_request: unknown | null;
    /**
     * Errata E-66 (7b), E-67 (5): a gift. The note was returned into this account's slots from a Spending account
     * this vault does not own (its address): it is under the account's keys, but anyone holding a view key can make
     * such an account. Show it labelled; absent for every other note.
     */
    from_account?: string;
}
export interface DepositPlan {
    generation: number;
    device_id: number;
    counter: number;
    request: {
        depositor: string;
        denom: string;
        amount: Amount;
        inner: Hex32;
    };
}
export interface FinishedDeposit {
    msg: ExecuteMsg;
    coin: Coin;
    degraded: boolean;
}
export interface AuthorizationRecord {
    action_id: number;
    kind: string;
    denom: string;
    amount: Amount;
    destination: string;
    dest_class: ReviewCard["dest_class"];
    confirmed_by: string | null;
    expiry_height: number;
    /** The split withdrawal this part belongs to (E-13). */
    withdrawal?: number;
    /** Errata E-38: the spent nullifier and the public-input digest (what a SLOW request's record shows). */
    nf?: Hex32;
    pi_digest?: Hex32;
}
export interface ConfirmRequest {
    action_id: number;
    card: ReviewCard;
    challenge: Hex32;
    /** Set when the card is a whole split withdrawal: one confirmation covers every part (E-13). */
    withdrawal?: number;
}
export interface NodeAttestation {
    node: string;
    expiry_height: number;
    root: {
        registered: {
            root: Hex32;
        };
    } | {
        inline: {
            root: Hex32;
            issue_height: number;
            count: number;
            signature: string;
        };
    };
    leaf_index: number;
    path: Hex32[];
}
export interface ExitPlan {
    to: Destination;
    address: string;
    generation: number;
    /**
     * Errata E-34, E-67 (2), (7): the `exit_lock` of the exited notes. In Normal and Alarm (`pin_sender`) the payee's
     * own wallet sends it (its authorization; to rescue it carries the notes' `hsalt`: the rescue pin, which refuses
     * home from the next block) and the reveal is relayed only once it is seen included in an earlier block
     * (`VaultService.sendExit` does this). Always present (pass 11b): under the mode rule (Bunker-K, Bunker-P, the
     * rescue build) it needs no authorization and only starts the forced lane's clock.
     */
    pin: ExecuteMsg;
    /**
     * Errata E-67 (2), (7): the address whose wallet must send `pin` (home, or rescue), in Normal and Alarm; `null`
     * under the mode rule (no authorization; a never-signed rescue does not sign in Bunker-K).
     */
    pin_sender: string | null;
    audits: ExecuteMsg[];
    reveal: ExecuteMsg;
    audited_per_message: number[][];
    exited: number[];
    total: Amount;
    /**
     * Errata E-66 (7d), E-67 (2): view keys of this account are out; the exit publishes the account's owner opening,
     * after which their holders can push the notes they see out to the owner's rescue or home (never elsewhere) in
     * Bunker-K, Bunker-P and the rescue build (in Normal and Alarm an exit needs the owner's own wallet). Show it
     * before the owner exits (never a block); afterwards `rotationAdvice` says `view_key_can_exit`.
     */
    view_key_warning?: string;
    /**
     * Errata E-67 (2), review F3: on an exit to rescue in Normal and Alarm, the advice to move the notes with the FAST
     * to rescue first (`VaultService.bringEverythingToRescue`): rescue signs nothing, no opening is published. Show
     * it before the owner picks the proof-free exit; never a block.
     */
    fast_to_rescue?: string;
    /**
     * Errata E-68 (3): history files of this account list notes as held that are still unspent; the exit publishes the
     * account's owner opening, with which their holders compute those notes' nullifiers and, in Bunker-K, Bunker-P and
     * the rescue build, can push them out to the owner's rescue or home. Moving them first (any spend) ends it. Show it
     * before the owner exits; never a block.
     */
    history_warning?: string;
}
/** The bulk feeds a sync reads (vault-core `feed::ChainSnapshot`). */
export interface ChainSnapshot {
    height: number;
    headers: unknown[];
    deposits: unknown[];
    notes: unknown[];
    nullifiers: unknown[];
    accounts: unknown[];
    returns: unknown[];
    slows: unknown[];
    queue: unknown[];
}
export interface Policy {
    send: {
        denom: string;
        capacity: Amount;
        refill_per_block: Amount;
    }[];
    trade: {
        denom: string;
        capacity: Amount;
        refill_per_block: Amount;
    }[];
    allow: {
        bank: string[];
        wasm: unknown[];
        thor: "deny" | "swap_to_self";
    };
    max_relayer_fee: Coin | null;
}
/** The proxy's `attest_root { node, root }` response. */
export interface AttestRootInfo {
    registered: boolean;
    count: number | null;
    expires: number | null;
}
/** The records of WP-E's bulk feeds at one pinned height (each the pages' `records` concatenated). */
export interface FeedRecords {
    height: number;
    notes: unknown[];
    nullifiers: unknown[];
    headers: unknown[];
    accounts: unknown[];
    slow: unknown[];
    queue: unknown[];
    deposits: unknown[];
    /** Errata E-66 (7d) fix: `{nk, height, kind}` of the owner openings published on chain (the node's `openings` feed). */
    openings?: unknown[];
}
/**
 * E-18, E-18a: the two account types; the phrase account is recommended and the default. A wallet account
 * signs in with ADR-036 `signArbitrary` (Cosmos wallets; `address` thor1…) or EIP-191 `personal_sign` (EVM
 * wallets; `address` the EIP-55 0x address), for Strict (`adr036`, `eip191`) or for the K contract's
 * Transition profile (`transition-adr036`, `transition-eip191`). The `-secp256k1` suffix is optional.
 */
export type WalletScheme = "adr036-secp256k1" | "eip191-secp256k1" | "transition-adr036-secp256k1" | "transition-eip191-secp256k1";
export type WalletSchemeName = WalletScheme | "adr036" | "eip191" | "transition-adr036" | "transition-eip191";
export type AccountKind = {
    kind: "phrase";
} | {
    kind: "wallet";
    scheme: "adr036-secp256k1" | "eip191-secp256k1";
    origin: string;
    address: string;
    deployment_id: Hex32;
    level: "wallet" | "passkey";
};
/**
 * E-18b: how a Strict wallet sign-in opens. `passkey` (recommended): `d` from the primary passkey's PRF output
 * for `util.walletPasskeySalt`; Two-Key Notes. `wallet`: wallet only, `d = d_w`. `home-only`: every passkey
 * lost, the wallet alone: pays home (and rescue) at once, nothing else.
 */
export type WalletLevelName = "passkey" | "wallet" | "home-only";
/** E-18b: what a passkey-level session's `d` is to the account (after a sync). */
export type PasskeyCheck = "not_passkey" | "home_only" | "fresh" | "matches" | "wallet_only_so_far" | "mismatch" | "restarted" | "protected_by_passkey";
/**
 * Errata E-72 (1): what `restorePasskeyBackup` did with the file's `d`: `own` (the session's own `d`, nothing added),
 * `exit_addresses` (errata E-63: the lost passkey's exit addresses only), `session` (the file's `d` is now the session's,
 * the full account: by the person's choice, `restorePasskeyBackupAs`, or, without one, only when this device's saved
 * state already confirms it), `other_generations` (review E72-1 and review run-4 R4-A: a cross-checked header binds the
 * file's `d`, but this device never confirmed it; the chain's `g` proves only that a holder of `S` bound that `d`, one
 * this account restarted away from (E-62) or one a holder of `S` wrote and funded at will (E-47), so nothing is adopted,
 * the file's `d` reaches the exit addresses, the vault UI shows `passkeyBackupGenerations` (its `notes` are information,
 * no evidence) and the person names their own generation, `restorePasskeyBackupAs`).
 */
export type PasskeyRestore = "own" | "exit_addresses" | "session" | "other_generations";
/** Errata E-72 (1), review E72-1: whose passkey a written header generation binds. */
export type GenerationOwner = "file" | "wallet_only" | "session" | "other";
/**
 * Errata E-72 (1), review E72-1: a written header generation as `passkeyBackupGenerations` lists it: its number, the
 * chain's height of it, whose passkey binds it, the unspent notes under it with their amounts per denomination (decimal
 * strings), and whether the sync that showed it was cross-checked (C5). The vault UI shows these rows before the person
 * names the generation that is theirs.
 */
export interface PasskeyBackupGeneration {
    deployment_id: string;
    generation: number;
    height: number;
    owner: GenerationOwner;
    notes: number;
    amounts: Record<string, string>;
    cross_checked: boolean;
}
/**
 * Errata E-72 (4), review E72-6: `passkeyFailed`: the passkey step was offered here and failed (`NotSupportedError`,
 * no PRF output, a cancelled or timed-out popup): the list without `passkey`, so the app falls through to the other
 * ways instead of forcing "Bring home".
 */
export interface OpeningOptions {
    passkeyFailed?: boolean;
}
/** Errata E-72 (4): what this browser can do before any passkey step (`probeCapabilities`). */
export interface Capabilities {
    /** `PublicKeyCredential` and `navigator.credentials` exist. */
    webauthn: boolean;
    /** The PRF extension, from `PublicKeyCredential.getClientCapabilities()`; `"unknown"` when the browser cannot say. */
    prf: boolean | "unknown";
    /** An in-app browser (a wallet app's, a social app's, a platform WebView), from the user agent. */
    in_app_browser: boolean;
    /** A platform authenticator with user verification is available; `"unknown"` when the browser cannot say. */
    user_verifying_platform: boolean | "unknown";
    /** The user agent the probe read. */
    agent: string;
}
/** Errata E-72 (4): the ways the app offers to open an account here (`openingPaths`), in order. */
export type OpeningPath = "passkey" | "pairing" | "passkey_backup" | "home_only" | "wallet_only";
/** Errata E-72 (4): what is being opened: a wallet + passkey account, the wallet-only level, or a new account. */
export type OpeningLevel = "passkey" | "wallet" | "new";
/**
 * Errata E-62 (owner F3): "Restart with this passkey". `offered`: show the one row (the account's generations
 * are another passkey's: every passkey lost, or a squatted `g`); false on a held session (errata E-72 review run-5:
 * an unconfirmed outside `d`, which `restartWithThisPasskey` refuses with `NEEDS_GENERATION_CHOICE`), and E-74 (7)
 * binds the app not to offer the restart from a paired or unlocked device. After the restart the new generation is
 * written like any header; `old_notes` (the lost passkey's) pay home at once ("Send home") or move privately (a SLOW
 * request to `move_account`, 7 days, cancellable, then returned as own money).
 */
export interface RestartReport {
    check: PasskeyCheck;
    offered: boolean;
    restarted: boolean;
    generation: number | null;
    written: boolean;
    old_notes: {
        cm: Hex32;
        denom: string;
        amount: string;
        generation: number;
    }[];
    /** Old notes with a pending SLOW request (moving privately, or vetoed home by the wallet's holder). */
    moving: {
        cm: Hex32;
        denom: string;
        amount: string;
        generation: number;
    }[];
    /** Old notes in a request not yet seen on chain (the next move waits for it). */
    in_flight: number;
    move_account: number | null;
    move_account_on_chain: boolean;
}
/** Errata E-61: an exit address of the vault (`s`: keyed from S; `s_d`: from S ‖ d, the passkey level) and what rests there. */
export interface ExitBalance {
    index: number;
    address: string;
    keying: ExitKeying;
    issued: boolean;
    balances: Coin[];
}
/** Errata E-61: what the platform reads of an L1 account for "Send home" (cosmos auth and bank). */
/** Errata E-61, E-63: the key material of an exit address: `S`, `S ‖ d`, or a passkey backup's `S ‖ d_backup`. */
export type ExitKeying = "s" | "s_d" | "s_d_backup";
export interface L1Account {
    accountNumber: number;
    sequence: number;
    balances: Coin[];
}
/** C4: the state of a header generation (vault-core `HeaderStatus`). */
export type HeaderState = {
    state: "planned";
} | {
    state: "committed";
    height: number;
} | {
    state: "written";
    height: number;
};
/** C4: where the current header generation stands and the next step to write it (vault-core `header_report`). */
export interface HeaderReport {
    generation: number;
    status: HeaderState | null;
    /** `sync`: read the chain first; `commit`, `reveal`: send that message; `done`: deposits open; `blocked`: see `reason`. */
    next: "sync" | "commit" | "reveal" | "done" | "blocked";
    deposits_open: boolean;
    reason?: string;
    /**
     * Once written: from this height no earlier commitment can replace the header (its first reveal +
     * `header_final_blocks`, about one day on mainnet). Until then the phrase alone recovers deposits under it
     * only if no earlier commitment is revealed there; this device keeps finding them either way (errata E-32).
     */
    final_height?: number;
}
/** E-18b: an account switch (wallet only → passkey) as the chain shows it (vault-core `switch_state`). */
export interface SwitchState {
    applicable: boolean;
    wallet_only_generations: number[];
    passkey_generations: number[];
    notes_left: number;
    value_left: Record<string, Amount>;
    /** A passkey generation exists and wallet-only notes are left: the switch did not finish. */
    unfinished: boolean;
    /** This session (wallet only) continues it with `beginUpgradeToPasskey` and the same passkey. */
    resumable_here: boolean;
    /**
     * Errata E-41: Spending accounts whose full key comes from the wallet signature (made at the wallet-only
     * level; the chain fixes the full key, the switch cannot change it): keep them empty and send nothing to
     * them, since one phished signature still signs for them.
     */
    wallet_key_accounts?: number[];
}
/** Errata E-38: this session's last sync (`sources` 2 = cross-checked, C5; 1 = one source). */
export interface SyncStatus {
    synced: boolean;
    height: number;
    sources: number;
    cross_checked: boolean;
}
/** A queued payout (vault-core `feed::QueueFeedRecord`). */
export interface QueueFeedRecord {
    id: number;
    denom: string;
    recipient: string;
    amount: Amount;
    paid: Amount;
    created: number;
    eligible: number;
    source: {
        fast: {
            stmt: number;
            nf_a: Hex32;
            nf_b?: Hex32 | null;
            hc: Hex32;
        };
    } | {
        slow: {
            nf: Hex32;
            hd: Hex32;
        };
    };
    watched: boolean;
    audit_only: boolean;
}
/** Errata E-34: a queued payout of this vault's spends (`myQueueItems`). */
export interface MyQueueItem {
    item: QueueFeedRecord;
    generation: number | null;
    /** It pays the spent notes' own home or rescue; otherwise a recipient (redirect it home if not yours). */
    to_own: boolean;
    /**
     * Pass 11b: an authorization of this vault names its first nullifier, recipient, coin and amount (the owner
     * made it here). Warn and offer the redirect home only when `to_own` and `authorized_here` are both false;
     * a payout made on another device of the account, or before a restore, shows as not authorized here too.
     */
    authorized_here: boolean;
}
/**
 * How a sync scans (spec §3.12): `deep` far beyond the spec's gaps, for a restore that misses money.
 * `min_height` (errata E-48): the chain tip the caller read itself; a snapshot more than ten blocks below
 * it, or below this session's last sync, is refused (`REPLAY`), so a feed node cannot tag the client with
 * an old root.
 */
export interface SyncOptions {
    deep?: boolean;
    min_height?: number;
}
/** C3: why a released action's inputs are freed: the node refused the relay, or its expiry passed. */
export type FreeInputs = "refused" | "expired";
/**
 * E-18a: what the wallet returned for `util.walletMessage` (raw, never "fixed"): ADR-036 `StdSignature`s from
 * `signArbitrary`, or EIP-191 `personal_sign` hex strings. Two equal answers, or one with the `fingerprint`
 * the device kept after the first sign-in (a mismatch is `NOT_DETERMINISTIC`: ask for the second answer).
 */
export interface WalletSignIn {
    scheme: WalletSchemeName;
    origin: string;
    address: string;
    signatures: [StdSignature] | [StdSignature, StdSignature] | [string] | [string, string];
    fingerprint?: Hex32;
}
/** E-13, E-18a: the K contract's keys of an account (the Transition profile); only these leave the vault. */
export interface TransitionKeys {
    /** A BN254 scalar, 64 lowercase hex characters. */
    owner_secret: Hex32;
    scan_key: Hex32;
    /** base64 of 16 bytes: the account's identity. */
    account_id: string;
}
/** What an ADR-036 wallet returns from `signArbitrary` (Keplr, Leap, …). */
export interface StdSignature {
    pub_key: {
        type: string;
        value: string;
    };
    signature: string;
}
/** Errata E-68 (3): what a history file lists; `{}` cuts at the synced height and leaves held notes' nullifiers out. */
export interface HistoryOptions {
    /** Errata E-68 (5): each held note's nullifier in the file (a viewer confirms them unspent at the cut; their next move becomes visible). */
    include_held_nullifiers?: boolean;
    /** The cut height: at most the synced height (the default). */
    cut_height?: number;
    /** Errata E-68 (12) M-2: accept that the live Spending accounts the file names stay linked (else retire them first). */
    accept_account_linkage?: boolean;
}
/** Errata E-68 (12) L-3: an address a history file names (or links: a depositor wallet), with its role. */
export interface NamedAddress {
    address: string;
    role: "action_account" | "pay_in_account" | "own_account" | "gift_account" | "exit_address" | "payee" | "depositor_wallet";
    note: string;
}
/** Errata E-68 (12) L-1: the move-first path (commitments hex): merge each pair, spend each single once. */
export interface HistoryMovePlan {
    merges: [Hex32, Hex32][];
    singles: Hex32[];
    /** Mirrored records whose held list was truncated: every unspent note below the tree size at their cut counts. */
    unknown_files: string[];
    /**
     * Errata E-68 (13) R2-L5: listed held notes left out because a merge would cancel the owner's own pending SLOW
     * request on them (§6.6.3): show the request; wait for its release, or merge knowingly and file the payment again.
     */
    pending_slow: PendingSlowMove[];
    /**
     * Errata E-68 (15) R4-01: moves of listed held notes under a pending SLOW request this device did not file (E-12):
     * each cancels that request (`note` is "cancels a request no device of yours filed"). Ask the owner whether a device
     * of theirs filed it (if one did, skip it here); otherwise run it: merge the two `notes`, or spend the one home.
     * Never offer to wait for such a request (its release pays whoever filed it).
     */
    cancelling: {
        notes: Hex32[];
        cancels: PendingSlowMove[];
        note: string;
    }[];
}
/** Errata E-68 (13) R2-L5: a listed held note under a pending SLOW request (`filed_here`: this device filed it). */
export interface PendingSlowMove {
    note: Hex32;
    nf: Hex32;
    recipient: string;
    denom: string;
    amount: Amount;
    release: number;
    filed_here: boolean;
}
/** Errata E-68 (13) R2-L3: why a listed Spending account counts as live. */
export type LiveReason = "current_action_account" | "unknown_role" | "not_read" | "holds_coins" | "standing_order" | "open_positions" | "one_source"
/** Errata E-68 (15) R4-02: a listed held note paid it after the cut and the file carries held nullifiers. */
 | "paid_after_cut";
/**
 * Errata E-68 (13) R2-L3: a Spending account's activity as one source of the platform reads it from the chain, at or
 * above the disclosure's synced height: bank balances, standing orders in force (the proxy's `standing_orders`), the
 * open positions the platform tracks (orders on a book, loans, liquidity).
 */
export interface AccountActivity {
    address: string;
    height: number;
    coins: Coin[];
    standing_orders: number;
    positions: number;
}
/** Errata E-68 (13) Info 7: the one message an acknowledgement of the history exposure covers. */
export type HistoryAckAction = {
    kind: "exit";
    notes: Hex32[];
    to: Destination;
} | {
    kind: "lineage_audits";
} | {
    kind: "veto_home";
    nf: Hex32;
} | {
    kind: "redirect_home";
    id: number;
};
/** Errata E-68: the cut of a history file: the height and that block's header hash (`block_id.hash`, lowercase hex). */
export interface HistoryCut {
    height: number;
    block_hash: Hex32;
}
/** Errata E-68 (3): what the vault UI shows before a history export; `exportHistory` needs `fingerprint` back. */
export interface HistoryDisclosure {
    fingerprint: string;
    cut: HistoryCut;
    /** The chain height of the sync the disclosure read first. */
    height: number;
    /** 2: that sync cross-checked two sources (C5); 1: one source. */
    sources: number;
    /** How many sources gave the cut's block hash (2: they agreed). */
    block_sources: number;
    held_nullifiers: boolean;
    counts: {
        notes: number;
        deposits: number;
        returns: number;
        gifts: number;
        changes: number;
        spent: number;
        held: number;
        pending_not_listed: number;
        after_cut_not_listed: number;
    };
    /** The value the file lists as held at the cut. */
    held: Record<string, Amount>;
    spending_accounts: string[];
    exit_addresses: string[];
    /** Errata E-68 (12) L-3, M-2, M-3: every address the file names, and the depositor wallets it links. */
    named_addresses: NamedAddress[];
    /**
     * Errata E-68 (12) M-2: the listed Spending accounts later actions would still use. Retire each before the file
     * leaves (a fresh action account `act#<n+1>` whatever the once-a-day limit says, the free coins returned to the
     * Reserve) and show the disclosure again; `exportHistory` refuses (`HISTORY_ACCOUNTS_LIVE`) otherwise, unless the
     * options accept the linkage.
     */
    live_accounts: {
        index: number;
        address: string;
        task: string | null;
        why: LiveReason[];
    }[];
    account_linkage_accepted: boolean;
    /** Errata E-68 (12) M-3: listed deposits whose paying wallet this device did not record. */
    depositor_wallets_unknown: number;
    /** Errata E-68 (12) L-7: generations with a listed SLOW spend (advise a new header generation). */
    slow_generations: number[];
    /** Errata E-68 (12) I-1: listed spends whose queued payout goes elsewhere now. */
    redirected: {
        index: number;
        authorized: string;
        now: string;
    }[];
    /** Errata E-68 (12) L-1: the owner opening is public: do not offer the held-nullifier option (it is void). */
    held_nullifiers_void: boolean;
    /**
     * Errata E-68 (15) R4-02: Spending accounts a listed held note paid after the cut while the file carries held
     * nullifiers (or the opening is public): named, and live until retired (`live_accounts`, why `paid_after_cut`).
     */
    paid_after_cut: string[];
    /**
     * Errata E-68 (15) R4-02: listed held notes spent after the cut by a spend whose payee this device cannot name (another
     * device's): the export then needs a later cut or the linkage accepted (`HISTORY_ACCOUNTS_LIVE` otherwise).
     */
    paid_after_cut_unknown: number;
    shows: string[];
    never: string[];
    warnings: string[];
}
/** Errata E-68: the exported history file (canonical JSON, one line) and its fingerprint. */
export interface HistoryExport {
    file: string;
    fingerprint: string;
}
/** Errata E-68 (3): the record of a history export (never the file). */
export interface HistoryExportRecord {
    fingerprint: string;
    cut_height: number;
    height: number;
    notes: number;
    held_nullifiers: boolean;
    spending_accounts: number;
    exit_addresses: number;
    /** The commitments of the notes the file lists as held. */
    held: Hex32[];
    /** Errata E-68 (12) L-2: a record mirrored from another device whose held list was cut short. */
    held_truncated?: boolean;
    /** Errata E-68 (13) Info 8: the note tree's size at the cut. */
    leaves_at_cut: number;
}
/** Errata E-68 (4): one listed note with its verdict (no `rho`). */
export interface HistoryItem {
    index: number;
    generation: number;
    cm: Hex32;
    denom: string;
    amount: Amount;
    height: number;
    arrived: {
        kind: "deposit";
        inner: Hex32;
    } | {
        kind: "return";
        account: string;
        inner: Hex32;
    } | {
        kind: "gift";
        account: string;
        inner: Hex32;
    } | {
        kind: "change";
        stmt: number;
        parents: Hex32[];
        out: Amount;
    };
    fate: {
        kind: "held";
        nf?: Hex32;
    } | {
        kind: "spent";
        nf: Hex32;
        height: number;
        by: "fast1" | "fast2" | "slow1" | "exit";
        child: number | null;
        payee: string | null;
        payee_is: "authorized_destination";
    };
    /** `stated`: an exit no published opening ties to this note (errata E-68 (4)(d)): shown, counted nowhere. */
    verdict: "not_checked" | "verified" | "stated" | "failed";
    /** For a spent note: what binds its nullifier (`child_opens`, `opening_published`, or `stated`). */
    spend_check?: "child_opens" | "opening_published" | "stated";
    /** For a held note: `not_checked` (nullifiers left out), `nullifier_unspent` (the named nullifier is unspent at the cut; that it is the note's needs nk), `nullifier_spent` (failed). */
    held_check?: "not_checked" | "nullifier_unspent" | "nullifier_spent";
    reasons: string[];
}
/** Errata E-68 (4): the last check of a history file. */
export interface HistoryStatus {
    cut: HistoryCut;
    held_nullifiers: boolean;
    checked: boolean;
    verified: boolean;
    failed: number;
    /** Errata E-68 (12) M-1: exits that are the file's statement. */
    stated: number;
    sources: number;
    block_sources: number;
    snapshot_heights: number[];
}
/** Errata E-68 (4): totals at the cut over the verified notes. Not a proof of funds. */
export interface HistoryTotals {
    held: Record<string, Amount>;
    held_nullifier_unspent: Record<string, Amount>;
    deposited: Record<string, Amount>;
    returned: Record<string, Amount>;
    gifts: Record<string, Amount>;
    left: Record<string, Amount>;
    counted: number;
}
/** Errata E-68 (4): a listed address and what the check says of it. */
export interface HistoryAccount {
    address: string;
    kind: "spending" | "exit";
    check: "not_checked" | "on_chain_at_cut" | "not_on_chain_at_cut" | "stated_by_file";
}
/** Errata E-66 (3): what a view key names; the default (`{}`) names every written generation and both lists. */
export interface ViewKeyOptions {
    /** Only these generation keys (each a written generation of the account). */
    generations?: number[] | null;
    omit_spending_accounts?: boolean;
    omit_exit_addresses?: boolean;
}
/** Errata E-66 (3): what the vault UI shows before an export; `exportViewKey` needs `fingerprint` back. */
export interface ViewKeyDisclosure {
    fingerprint: string;
    /** The chain height of the sync the disclosure read first (the export refers to the same height). */
    height: number;
    /** 2: that sync cross-checked two sources (C5); 1: one source. */
    sources: number;
    generations: number[];
    spending_accounts: {
        index: number;
        address: string;
    }[];
    exit_addresses: string[];
    notes: number;
    unspent: Record<string, Amount>;
    /** What a holder sees. */
    shows: string[];
    /** What a holder can never do. */
    never: string[];
    /** What a holder can do all the same, and how it ends (E-66 (7), (8)). */
    warnings: string[];
}
/** Errata E-66: the exported file (canonical JSON, one line) and its fingerprint. */
export interface ViewKeyExport {
    file: string;
    fingerprint: string;
}
/** Errata E-66 (3): the record of an export (never the file or its keys). */
export interface ViewKeyExportRecord {
    fingerprint: string;
    height: number;
    generations: number[];
    spending_accounts: number[];
    exit_addresses: number;
}
/** Errata E-66 (4): a note as a view key shows it (no `rho`). */
export interface ViewNote {
    index: number | null;
    cm: Hex32;
    nf: Hex32;
    denom: string;
    amount: Amount;
    generation: number;
    origin: {
        kind: "deposit";
        generation: number;
        device_id: number;
        counter: number;
    } | {
        kind: "slot";
        account_index: number;
        slot_generation: number;
        k: number;
    } | {
        kind: "change";
        stmt: number;
        nf_a: Hex32;
        nf_b?: Hex32 | null;
        out_amount: Amount;
    };
    status: {
        state: "unspent" | "pending" | "refunded" | "spent";
        kind?: string;
        height?: number;
        child?: number | null;
    };
    slow_request: unknown | null;
    /**
     * Errata E-66 (fix, view-key audit run-1 L4): whether `generation` is one the file names. A note under a number the
     * file does not name (a named pk tried there: a later generation with the same values, or a deposit anyone holding
     * the file can plant) is `false`: show it apart, never as the account's; `balances()` leaves it out.
     */
    generation_named: boolean;
}
/** Errata E-66 (4): one event of the account's history, oldest first. */
export type ViewEvent = {
    event: "deposit";
    height: number | null;
    index: number | null;
    generation: number;
    denom: string;
    amount: Amount;
    source: string | null;
    status: "pending" | "admitted" | "refunded";
    generation_named: boolean;
} | {
    event: "return";
    height: number | null;
    index: number | null;
    generation: number;
    account_index: number;
    account: string | null;
    account_owner: Ownership;
    denom: string;
    amount: Amount;
    own_funds: boolean | null;
    status: "pending" | "admitted" | "refunded";
} | {
    event: "spend";
    height: number;
    kind: "fast1" | "fast2" | "slow1" | "exit" | "queue_audit";
    inputs: number[];
    denom: string;
    amount: Amount;
    change: number | null;
} | {
    event: "slow_request";
    height: number;
    input: number | null;
    record: unknown;
} | {
    event: "queued";
    height: number;
    item: QueueFeedRecord;
};
/**
 * Errata E-66 (fix): whether a Spending account is established as the viewed account's own: listed by the file
 * and carrying the key's slot tree (`established`), listed without it or found only by its returns into the key's
 * slot inners (`not_established`: anyone holding the view key can make such an account), or not on chain.
 */
export type Ownership = "established" | "not_established" | "not_on_chain";
/** Errata E-66 (4): a Spending account the file lists, with its returns (accounts found only by slot inners are not listed). */
export interface ViewAccount {
    index: number;
    address: string;
    listed: boolean;
    owner: Ownership;
    record: unknown | null;
    returns: ViewNote[];
}
/** Errata E-66 (4): the view session's last sync (`sources` 2 = cross-checked, C5). */
export interface ViewSyncStatus {
    synced: boolean;
    height: number;
    sources: number;
    /** Errata E-48 for the viewer: the chain tip the platform read itself (`ViewerEnv.height()`). */
    min_height?: number;
    /** Errata E-66 (fix): what the chain says of the file's nk (`contradicted`: a damaged or forged file). */
    nk_check?: "verified" | "unverified" | "contradicted";
}
