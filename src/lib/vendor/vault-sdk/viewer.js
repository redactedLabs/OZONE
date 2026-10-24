// The view-only session for a viewer page (errata E-66 (4), (5)). Built from a view-key file and a deployment,
// it reads the chain's bulk feeds (and, when the platform gives `l1Account`, the L1 balances of the addresses
// the file lists) and answers with notes, balances, the history and the listed accounts' activity.
//
// It holds no wallet, no key, no prover, no relay and no storage. The file it opens holds no secret (E-66 (2)),
// and nothing here prepares, signs, proves or builds a message: `VIEWER_METHODS` is its whole API, and
// `dispatchViewer` serves only those. A view key cannot be revoked (E-66 (8)): hand the file only to whom the
// owner means to.
import { core, asVaultError, VaultError } from "./core.js";
/** Every method of `ViewerService`: reads only. */
export const VIEWER_METHODS = ["open", "fingerprint", "generations", "spendingAccounts", "exitAddresses", "sync", "status", "notes", "balances", "history", "accounts", "addressBalances", "warnings", "close"];
function call(f) {
    try {
        return f();
    }
    catch (e) {
        throw asVaultError(e);
    }
}
export class ViewerService {
    env;
    s = null;
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
     * always `claimed_by_file`: nothing public ties it to the account.
     */
    async addressBalances() {
        if (!this.env.l1Account)
            throw new VaultError("UNSUPPORTED", "the platform reads no L1 accounts (env.l1Account)");
        const out = [];
        const accounts = this.accounts();
        for (const { address } of this.spendingAccounts()) {
            const owner = accounts.find((a) => a.address === address)?.owner ?? "not_established";
            out.push({ address, kind: "spending", owner, balances: (await this.env.l1Account(address)).balances });
        }
        for (const address of this.exitAddresses())
            out.push({ address, kind: "exit", owner: "claimed_by_file", balances: (await this.env.l1Account(address)).balances });
        return out;
    }
    /** The warnings: first, always, that the file is not authenticated (no proof of funds); then the last sync's (one source, an unconfirmed `nk`, notes under numbers the file does not name, the replay's own). */
    warnings() {
        return JSON.parse(call(() => this.need().warnings()));
    }
    close() {
        this.s?.free?.();
        this.s = null;
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
