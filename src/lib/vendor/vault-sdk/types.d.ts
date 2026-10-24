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
 * Errata E-62 (owner F3): "Restart with this passkey". `offered`: show the one row (the account's generations
 * are another passkey's: every passkey lost, or a squatted `g`). After the restart the new generation is written
 * like any header; `old_notes` (the lost passkey's) pay home at once ("Send home") or move privately (a SLOW
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
