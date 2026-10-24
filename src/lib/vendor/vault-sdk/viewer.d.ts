import type { Amount, ChainSnapshot, Coin, Deployment, L1Account, Ownership, ViewAccount, ViewEvent, ViewNote, ViewSyncStatus } from "./types.js";
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
}
/** Every method of `ViewerService`: reads only. */
export declare const VIEWER_METHODS: readonly ["open", "fingerprint", "generations", "spendingAccounts", "exitAddresses", "sync", "status", "notes", "balances", "history", "accounts", "addressBalances", "warnings", "close"];
export declare class ViewerService {
    private readonly env;
    private s;
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
