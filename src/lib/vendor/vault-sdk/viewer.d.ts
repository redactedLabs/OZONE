import type { Amount, ChainSnapshot, Coin, Deployment, HistoryAccount, HistoryCut, HistoryItem, HistoryStatus, HistoryTotals, L1Account, Ownership, ViewAccount, ViewEvent, ViewNote, ViewSyncStatus } from "./types.js";
export interface ViewerEnv {
    deployment: Deployment;
    /** The bulk feeds at one height from one source (a one-source sync: one node could hide a SLOW request). */
    readSnapshot(): Promise<ChainSnapshot>;
    /** C5 (preferred): the bulk feeds at one height from two independent sources, cross-checked by vault-core. */
    readSnapshots?(): Promise<[ChainSnapshot, ChainSnapshot]>;
    /**
     * Errata E-48 for the viewer (errata E-66 fix): the chain tip the platform reads itself (not the feed nodes'
     * word). Every sync then refuses a snapshot more than ten blocks below it, so a lagging or dishonest pair of
     * sources cannot show notes spent since as unspent. Preferred; without it the viewer trusts the feeds' height.
     */
    height?(): Promise<number>;
    /** The L1 balances of an address (cosmos bank), for the Spending and exit addresses the file lists. */
    l1Account?(address: string): Promise<L1Account>;
    /**
     * Errata E-68 (4): the CometBFT header hash (`block_id.hash`, hex) of the block at `height` from each independent
     * source the platform reads (one or two), for a history file's cut.
     */
    blockHashes?(height: number): Promise<string[]>;
    /**
     * Errata E-68 (14) R3-J3, (15) R4-J1: this viewer's own block-window seed for a file (64 hex characters). Required to
     * verify a history file (`UNSUPPORTED` without it). The viewer page persists one random 32-byte seed per file
     * fingerprint (made once with `crypto.getRandomValues`, kept in its own storage, never sent anywhere) and returns the
     * same seed every time that file is verified again; the viewer itself keeps nothing.
     */
    windowSeed?(fingerprint: string): Promise<string>;
}
/**
 * Errata E-68 (14) R3-J3: the heights `[lo, hi]` a reader with `seedHex` asks for a cut (vault-core's
 * `history::cut_window`: `x = SHA-256(seed ‖ u64(cut))`, width `8 + u32(x[0..4]) mod 17`, the cut's place
 * `u32(x[4..8]) mod width`).
 */
export declare function historyCutWindow(seedHex: string, cut: number): Promise<[number, number]>;
/**
 * Every method of `ViewerService`: reads only. Errata E-68 (4): the history methods (`openHistory` … `closeHistory`)
 * open a history file and check it against the chain at its cut; they read only as well.
 */
export declare const VIEWER_METHODS: readonly ["open", "fingerprint", "generations", "spendingAccounts", "exitAddresses", "sync", "status", "notes", "balances", "history", "accounts", "addressBalances", "warnings", "close", "openHistory", "historyCut", "verifyHistory", "historyStatus", "historyItems", "historyTotals", "historyAccounts", "historyWarnings", "closeHistory"];
export declare class ViewerService {
    private readonly env;
    private s;
    /** Errata E-68 (4): the open history session (the wasm `WasmHistorySession`). */
    private h;
    constructor(env: ViewerEnv);
    private need;
    /** Open a view-key file (`VIEW_KEY_INVALID` for anything but the canonical file of this deployment). */
    open(file: string): {
        fingerprint: string;
        generations: number[];
    };
    fingerprint(): string;
    generations(): number[];
    spendingAccounts(): {
        index: number;
        address: string;
    }[];
    exitAddresses(): string[];
    /**
     * Read the chain and replay it from the file: at the tip the platform reads (`env.height`, E-48), from two
     * sources when the platform gives them (C5, a deep sync too), else one.
     */
    sync(opts?: {
        deep?: boolean;
    }): Promise<ViewSyncStatus>;
    status(): ViewSyncStatus;
    notes(): ViewNote[];
    /**
     * The unspent, admitted value per denomination under the generations the file names (errata E-66 fix, view-key audit
     * run-1 L4, M5): what the chain holds under the file's values. A view-key file is not authenticated: never present
     * this as a proof of funds (`warnings()[0]` says so; `status().nk_check` says whether the chain confirmed the file's
     * `nk`; notes under numbers the file does not name come with `generation_named: false` and are not counted).
     */
    balances(): Record<string, Amount>;
    history(): ViewEvent[];
    accounts(): ViewAccount[];
    /**
     * The L1 balances of the listed Spending and exit addresses (public chain data; needs `env.l1Account`), each with
     * what establishes it as the account's (errata E-66 fix): a Spending account `established` only when its record
     * carries the key's slot tree (after a sync; else `not_established` or `not_on_chain`); an exit address is
     * always `claimed_by_file`: nothing public ties it to the account.
     */
    addressBalances(): Promise<{
        address: string;
        kind: "spending" | "exit";
        owner: Ownership | "claimed_by_file";
        balances: Coin[];
    }[]>;
    /** The warnings: first, always, that the file is not authenticated (no proof of funds); then the last sync's (one source, an unconfirmed `nk`, notes under numbers the file does not name, the replay's own). */
    warnings(): string[];
    close(): void;
    /** Open a history file (`HISTORY_INVALID` for anything but the canonical file of this deployment). */
    openHistory(file: string): {
        fingerprint: string;
        cut: HistoryCut;
        held_nullifiers: boolean;
    };
    /** The cut: the height up to which the file shows the account, and that block's header hash. */
    historyCut(): HistoryCut;
    /**
     * Check every item of the open file against the chain at its cut: the bulk feeds from two sources when the platform
     * gives them (C5), else one, each at or above the cut, and the header hash of the block at the cut from the
     * platform's sources (`env.blockHashes`). vault-core drops every record above the cut before it matches anything.
     */
    verifyHistory(): Promise<HistoryStatus>;
    /** Whether every item verified, the sources, the block-hash check, the heights read. */
    historyStatus(): HistoryStatus;
    /** Every listed note with its verdict (payees are the file's statement: `payee_is`). */
    historyItems(): HistoryItem[];
    /** Totals at the cut over the verified notes. Not a proof of funds (`historyWarnings()[0]`). */
    historyTotals(): HistoryTotals;
    /** The listed Spending accounts (on chain at the cut, or not) and exit addresses (the file's claim). */
    historyAccounts(): HistoryAccount[];
    /** The warnings: first, always, that the file is not authenticated and that its completeness rests on the owner. */
    historyWarnings(): string[];
    closeHistory(): void;
}
/** Dispatch one request `{ id, method, params }` of a viewer page: `VIEWER_METHODS` only. */
export declare function dispatchViewer(svc: ViewerService, msg: {
    id: number;
    method: string;
    params?: any[];
}): Promise<{
    id: number;
    result?: unknown;
    error?: {
        code: string;
        message: string;
    };
}>;
