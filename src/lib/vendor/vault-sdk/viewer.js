// The view-only session for a viewer page (errata E-66 (4), (5)). Built from a view-key file and a deployment,
// it reads the chain's bulk feeds (and, when the platform gives `l1Account`, the L1 balances of the addresses
// the file lists) and answers with notes, balances, the history and the listed accounts' activity.
//
// It holds no wallet, no key, no prover, no relay and no storage. The file it opens holds no secret (E-66 (2)),
// and nothing here prepares, signs, proves or builds a message: `VIEWER_METHODS` is its whole API, and
// `dispatchViewer` serves only those. A view key cannot be revoked (E-66 (8)): hand the file only to whom the
// owner means to.
import { core, asVaultError, VaultError, cutBlockHashes, randomBelow32, utf8Over, washStack, VIEW_KEY_MAX_BYTES, HISTORY_MAX_BYTES } from "./core.js";
/** Errata E-78 (6): the mean pause between two reads of `addressBalances` (each pause uniform in [0, 2 · mean]). */
export const ADDRESS_READ_SPREAD_MS = 1_500;
/**
 * Errata E-68 (14) R3-J3: the heights `[lo, hi]` a reader with `seedHex` asks for a cut (vault-core's
 * `history::cut_window`: `x = SHA-256(seed ‖ u64(cut))`, width `8 + u32(x[0..4]) mod 17`, the cut's place
 * `u32(x[4..8]) mod width`).
 */
export async function historyCutWindow(seedHex, cut) {
    const seed = Uint8Array.from(seedHex.match(/../g).map((x) => parseInt(x, 16)));
    const m = new Uint8Array(40);
    m.set(seed, 0);
    new DataView(m.buffer).setBigUint64(32, BigInt(cut));
    const x = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", m));
    const dv = new DataView(x.buffer, x.byteOffset, x.byteLength);
    const width = 8 + (dv.getUint32(0) % 17);
    const place = dv.getUint32(4) % width;
    const lo = Math.max(0, cut - place);
    return [lo, lo + width - 1];
}
/**
 * Errata E-68 (14) R3-J3, (15) R4-J1: a viewer's window seed for a file: the page's (`windowSeed`), required. A seed the
 * viewer made up per service would change with every reload, and each new seed shows the nodes another window around
 * the cut: their union narrows the cut down.
 */
async function windowSeed(env, fingerprint) {
    if (!env.windowSeed) {
        throw new VaultError("UNSUPPORTED", "the viewer page keeps no window seed (env.windowSeed): it persists one random 32-byte seed per file fingerprint and gives the same one every time (errata E-68 (15))");
    }
    const given = (await env.windowSeed(fingerprint)).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(given))
        throw new VaultError("INVALID_INPUT", "a window seed is 64 hex characters");
    return given;
}
/**
 * Every method of `ViewerService`: reads only. Errata E-68 (4): the history methods (`openHistory` … `closeHistory`)
 * open a history file and check it against the chain at its cut; they read only as well.
 */
export const VIEWER_METHODS = [
    "open", "fingerprint", "generations", "spendingAccounts", "exitAddresses", "sync", "status", "notes", "balances", "history", "accounts", "addressBalances", "warnings", "close",
    "openHistory", "historyCut", "verifyHistory", "historyStatus", "historyItems", "historyTotals", "historyAccounts", "historyWarnings", "closeHistory",
];
function opened(h) {
    if (!h)
        throw new VaultError("LOCKED", "open a history file first");
    return h;
}
function call(f) {
    try {
        return f();
    }
    catch (e) {
        throw asVaultError(e);
    }
    finally {
        // errata E-78 (78): as in core.ts: overwrite what the call left on the wasm stack
        washStack();
    }
}
export class ViewerService {
    env;
    s = null;
    /** Errata E-68 (4): the open history session (the wasm `WasmHistorySession`). */
    h = null;
    constructor(env) {
        this.env = env;
    }
    need() {
        if (!this.s)
            throw new VaultError("LOCKED", "open a view-key file first");
        return this.s;
    }
    /** Open a view-key file (`VIEW_KEY_INVALID` for anything but the canonical file of this deployment). */
    open(file) {
        this.close();
        // errata E-68 (12) I-2, (13) R2-I2: a text longer than the parser reads (in UTF-8 bytes) never reaches the module
        if (typeof file !== "string" || utf8Over(file, VIEW_KEY_MAX_BYTES))
            throw new VaultError("VIEW_KEY_INVALID", `larger than ${VIEW_KEY_MAX_BYTES} bytes of UTF-8 (refused before the module reads it)`);
        this.s = call(() => core().openViewKey(file, JSON.stringify(this.env.deployment)));
        return { fingerprint: this.fingerprint(), generations: this.generations() };
    }
    fingerprint() {
        return call(() => this.need().fingerprint());
    }
    generations() {
        return JSON.parse(call(() => this.need().generations()));
    }
    spendingAccounts() {
        return JSON.parse(call(() => this.need().spendingAccounts())).map(([index, address]) => ({ index, address }));
    }
    exitAddresses() {
        return JSON.parse(call(() => this.need().exitAddresses()));
    }
    /**
     * Read the chain and replay it from the file: at the tip the platform reads (`env.height`, E-48), from two
     * sources when the platform gives them (C5, a deep sync too), else one.
     */
    async sync(opts = {}) {
        const s = this.need();
        if (this.env.height) {
            const tip = await this.env.height();
            call(() => s.setMinHeight(BigInt(tip)));
        }
        if (this.env.readSnapshots) {
            const [a, b] = await this.env.readSnapshots();
            if (opts.deep)
                call(() => s.syncCheckedDeep(JSON.stringify(a), JSON.stringify(b)));
            else
                call(() => s.syncChecked(JSON.stringify(a), JSON.stringify(b)));
        }
        else {
            const snap = await this.env.readSnapshot();
            call(() => s.syncWith(JSON.stringify(snap), opts.deep ?? false));
        }
        return this.status();
    }
    status() {
        return JSON.parse(call(() => this.need().syncStatus()));
    }
    notes() {
        return JSON.parse(call(() => this.need().notes()));
    }
    /**
     * The unspent, admitted value per denomination under the generations the file names (errata E-66 fix, view-key audit
     * run-1 L4, M5): what the chain holds under the file's values. A view-key file is not authenticated: never present
     * this as a proof of funds (`warnings()[0]` says so; `status().nk_check` says whether the chain confirmed the file's
     * `nk`; notes under numbers the file does not name come with `generation_named: false` and are not counted).
     */
    balances() {
        return JSON.parse(call(() => this.need().balances()));
    }
    history() {
        return JSON.parse(call(() => this.need().history()));
    }
    accounts() {
        return JSON.parse(call(() => this.need().accountActivity()));
    }
    /**
     * The L1 balances of the listed Spending and exit addresses (public chain data; needs `env.l1Account`), each with
     * what establishes it as the account's (errata E-66 fix): a Spending account `established` only when its record
     * carries the key's slot tree (after a sync; else `not_established` or `not_on_chain`); an exit address is
     * always `claimed_by_file`: nothing public ties it to the account. Errata E-78 (6): read in random order with a random
     * pause before every read after the first (mean `opts.spreadMs`, default 1.5 s), the two lists through different readers
     * when the platform gives several (`env.l1Accounts`). Mitigated, not closed: a reader can still group what it reads from
     * one client; only a bulk or local read would close it. The answer keeps the file's order.
     */
    async addressBalances(opts = {}) {
        const env = this.env;
        const l1 = env.l1Account;
        const readers = env.l1Accounts?.length ? env.l1Accounts : l1 ? [(address) => l1.call(env, address)] : [];
        if (readers.length === 0)
            throw new VaultError("UNSUPPORTED", "the platform reads no L1 accounts (env.l1Account)");
        const accounts = this.accounts();
        const out = [];
        for (const { address } of this.spendingAccounts())
            out.push({ address, kind: "spending", owner: accounts.find((a) => a.address === address)?.owner ?? "not_established", balances: [] });
        for (const address of this.exitAddresses())
            out.push({ address, kind: "exit", owner: "claimed_by_file", balances: [] });
        const order = out.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
            const j = randomBelow32(i + 1);
            [order[i], order[j]] = [order[j], order[i]];
        }
        const spread = opts.spreadMs ?? ADDRESS_READ_SPREAD_MS;
        const pause = env.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
        let reads = 0;
        for (const i of order) {
            if (reads++ > 0 && spread > 0)
                await pause(randomBelow32(2 * spread + 1));
            // close() stops the rest
            this.need();
            const row = out[i];
            row.balances = (await readers[row.kind === "exit" ? readers.length - 1 : 0](row.address)).balances;
        }
        return out;
    }
    /** The warnings: first, always, that the file is not authenticated (no proof of funds); then the last sync's (one source, an unconfirmed `nk`, notes under numbers the file does not name, the replay's own). */
    warnings() {
        return JSON.parse(call(() => this.need().warnings()));
    }
    close() {
        // errata E-78 (78): through `call`, which washes the stack (the session wipes its keys in place)
        call(() => this.s?.free?.());
        this.s = null;
    }
    // ---- history files (errata E-68 (4)): read only; nothing after the cut is read or shown
    /** Open a history file (`HISTORY_INVALID` for anything but the canonical file of this deployment). */
    openHistory(file) {
        this.closeHistory();
        // errata E-68 (12) I-2, (13) R2-I2: a text longer than the parser reads (in UTF-8 bytes) never reaches the module
        if (typeof file !== "string" || utf8Over(file, HISTORY_MAX_BYTES))
            throw new VaultError("HISTORY_INVALID", `larger than ${HISTORY_MAX_BYTES} bytes of UTF-8 (refused before the module reads it)`);
        this.h = call(() => core().openHistory(file, JSON.stringify(this.env.deployment)));
        return { fingerprint: call(() => this.h.fingerprint()), cut: this.historyCut(), held_nullifiers: call(() => this.h.heldNullifiersIncluded()) };
    }
    /** The cut: the height up to which the file shows the account, and that block's header hash. */
    historyCut() {
        return JSON.parse(call(() => opened(this.h).cut()));
    }
    /**
     * Check every item of the open file against the chain at its cut: the bulk feeds from two sources when the platform
     * gives them (C5), else one, each at or above the cut, and the header hash of the block at the cut from the
     * platform's sources (`env.blockHashes`). vault-core drops every record above the cut before it matches anything.
     */
    async verifyHistory() {
        const h = opened(this.h);
        if (!this.env.blockHashes)
            throw new VaultError("UNSUPPORTED", "the platform reads no block hashes (env.blockHashes): a history file names the block at its cut");
        const cut = this.historyCut().height;
        const snaps = this.env.readSnapshots ? await this.env.readSnapshots() : [await this.env.readSnapshot()];
        // errata E-68 (12) L-4, (13) R2-L6: inside the window of heights the file fixes around its cut (the same every time),
        // never above the feeds read: a file whose window reaches higher is verified later
        const top = Math.min(...snaps.map((s) => s.height));
        // errata E-68 (14) R3-J3: from this viewer's own seed for the file (never the file's: every viewer would ask alike)
        const [lo, hi] = await historyCutWindow(await windowSeed(this.env, call(() => h.fingerprint())), cut);
        if (hi > top)
            throw new VaultError("NEEDS_SYNC", `the chain read is at height ${top}; this file's block window reaches ${hi}: verify again once the chain is past it`);
        const hashes = await cutBlockHashes(this.env.blockHashes.bind(this.env), cut, [lo, hi]);
        if (snaps.length === 2)
            call(() => h.verify(JSON.stringify(snaps[0]), JSON.stringify(snaps[1]), JSON.stringify(hashes)));
        else
            call(() => h.verify(JSON.stringify(snaps[0]), undefined, JSON.stringify(hashes.slice(0, 1))));
        return this.historyStatus();
    }
    /** Whether every item verified, the sources, the block-hash check, the heights read. */
    historyStatus() {
        return JSON.parse(call(() => opened(this.h).status()));
    }
    /** Every listed note with its verdict (payees are the file's statement: `payee_is`). */
    historyItems() {
        return JSON.parse(call(() => opened(this.h).items()));
    }
    /** Totals at the cut over the verified notes. Not a proof of funds (`historyWarnings()[0]`). */
    historyTotals() {
        return JSON.parse(call(() => opened(this.h).totals()));
    }
    /** The listed Spending accounts (on chain at the cut, or not) and exit addresses (the file's claim). */
    historyAccounts() {
        return JSON.parse(call(() => opened(this.h).accounts()));
    }
    /** The warnings: first, always, that the file is not authenticated and that its completeness rests on the owner. */
    historyWarnings() {
        return JSON.parse(call(() => opened(this.h).warnings()));
    }
    closeHistory() {
        call(() => this.h?.free?.());
        this.h = null;
    }
}
/** Dispatch one request `{ id, method, params }` of a viewer page: `VIEWER_METHODS` only. */
export async function dispatchViewer(svc, msg) {
    try {
        if (!VIEWER_METHODS.includes(msg.method))
            throw new VaultError("FORBIDDEN", `${msg.method} is not a viewer method`);
        const result = await svc[msg.method].apply(svc, msg.params ?? []);
        return { id: msg.id, result };
    }
    catch (e) {
        const err = e instanceof VaultError ? e : asVaultError(e);
        return { id: msg.id, error: { code: err.code, message: err.message } };
    }
}
