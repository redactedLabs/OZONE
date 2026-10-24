// Makes view-fixture.json for the view-key page's tests: a test account on vault-core's simulated proxy
// (test secrets, a localnet deployment; no real key anywhere), its view-key file, the proxy's feed records
// at the tip, the spend events of its blocks, and what the SDK's own ViewerService answers for it.
//
//   node src/lib/viewkey/__fixtures__/generate.mjs <hops export>   (a `git archive` export of hops integration
//   3e9aa75 with packages/vault-sdk built: wasm-test/ and dist/; see src/lib/vendor/vault-sdk/PROVENANCE.txt)
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hops = process.argv[2];
if (!hops) throw new Error("usage: generate.mjs <hops export>");
const H = await import(path.join(path.resolve(hops), "packages/vault-sdk/test/helpers.mjs"));
const { sdk, wasm, addr, config, localDeployment, RUNE, writeHeader, deposit, opts, proveAndSend } = H;

const S = "c1".repeat(32);
const D = "c2".repeat(32);
const dep = localDeployment();
const sim = new wasm.WasmSim(JSON.stringify(dep));
const v = new sdk.Vault(wasm.WasmVault.fromSecretsForTests(S, D, 0, JSON.stringify(config())));
const d = v.attach(dep);
const words = v.phrase().split(" ");
if (!v.confirmPhraseWords(v.phraseChallenge().map((p) => [p, words[p]]))) throw new Error("phrase gate");
writeHeader(sim, v, d);
const wallet = addr("wallet");
const exchange = addr("exchange");
const bob = addr("bob");
const shop = addr("shop");
sim.credit(wallet, "rune", String(100n * RUNE));
sim.credit(exchange, "rune", String(100n * RUNE));
const spends = []; // in order: the recipient and kind of each spend message
deposit(sim, v, d, wallet, 20n * RUNE);
sim.advance(3n);
deposit(sim, v, d, wallet, 5n * RUNE);
sim.advance(3n);
deposit(sim, v, d, exchange, 30n * RUNE);
sim.advance(3n);
const unspent = (amount) => v.notes(d).find((n) => n.amount === String(amount) && n.status.state === "unspent").handle;
proveAndSend(sim, v, v.prepareSpend(d, [unspent(20n * RUNE)], String(3n * RUNE), { kind: "withdraw", recipient: bob, home_only: false }, opts(sim)));
spends.push({ kind: "withdraw", recipient: bob });
v.sync(d, sim.snapshot());
sim.advance(3n);
const acc = v.accountForTask(d, "view");
proveAndSend(sim, v, v.prepareSpend(d, [unspent(17n * RUNE)], String(4n * RUNE), { kind: "fund", account: acc.address, create: acc.params }, opts(sim)));
spends.push({ kind: "fund", recipient: acc.address });
v.sync(d, sim.snapshot());
sim.advance(3n);
const calls = [{ bank_send: { to_address: bob, amount: [{ denom: "rune", amount: String(RUNE) }] } }];
const fees = { relayer_fee: null, relayer_fee_recipient: "", fee_policy_version: 0, protocol_fee_bps: sim.protocolFeeBps(), protocol_fees: JSON.parse(sim.quoteCallFees(JSON.stringify(calls))) };
sim.execute(sim.node(), JSON.stringify(v.accountCall(d, acc.index, "full", calls, fees, Number(sim.height()) + 300)), "[]");
const callHeight = Number(sim.height());
sim.advance(3n);
const r = v.prepareReturn(d, acc.index, [{ denom: "rune", amount: String(2n * RUNE) }], Number(sim.height()) + 300);
const att = JSON.parse(sim.attestReturn(r.account, BigInt(r.nonce), JSON.stringify(r.attest_request.slots)));
sim.execute(sim.node(), JSON.stringify(v.finishReturn(d, r, "full", att, Number(sim.height()), undefined, 1)), "[]");
v.sync(d, sim.snapshot());
sim.advance(3n);
sim.setQueueThreshold(String(5n * RUNE));
proveAndSend(sim, v, v.prepareSpend(d, [unspent(30n * RUNE)], String(10n * RUNE), { kind: "withdraw", recipient: shop, home_only: false }, opts(sim)));
spends.push({ kind: "withdraw", recipient: shop });
v.sync(d, sim.snapshot());
sim.advance(3n);
v.freshExitAddress(d);
v.sync(d, sim.snapshot());

// the export (errata E-66 (3)): the disclosure reads the chain first, then the file for its fingerprint
const disclosure = v.viewKeyDisclosure(d, {}, sim.snapshot(), sim.snapshot(), { min_height: Number(sim.height()) });
const { file, fingerprint } = v.exportViewKey(d, {}, disclosure.fingerprint);

// what the SDK's own viewer answers (wasm-test module; the page runs the production module)
const snap = () => JSON.parse(sim.snapshot());
const viewer = new sdk.ViewerService({
  deployment: dep,
  readSnapshot: async () => snap(),
  readSnapshots: async () => [snap(), snap()],
  height: async () => Number(sim.height()),
  l1Account: async (address) => ({ accountNumber: 0, sequence: 0, balances: [{ denom: "rune", amount: sim.balance(address, "rune") }] }),
});
viewer.open(file);
const status = await viewer.sync();
const notes = viewer.notes();
const history = viewer.history();

// The transactions that executed the proxy and the Spending account, as CometBFT's tx_search returns them
// (`execute._contract_address`): the proxy's `hops_deposit` (admission.rs) and `hops_spend` (private.rs)
// events with their attributes, the account call's bank transfer; plus a failed transaction and another
// contract's event in the same transaction, which the page must ignore.
const byIndex = new Map(notes.filter((n) => n.index !== null).map((n) => [n.index, n]));
const ev = (type, attrs) => ({ type, attributes: Object.entries(attrs).map(([key, value]) => ({ key, value: String(value), index: true })) });
const execute = (contract) => ev("execute", { _contract_address: contract, msg_index: 0 });
let n = 0;
const tx = (height, events, code = 0) => ({ hash: (++n).toString(16).toUpperCase().padStart(64, "0"), height: String(height), index: 0, tx_result: { code, events } });
const proxyTxs = [];
for (const e of history.filter((e) => e.event === "deposit")) {
  const cm = byIndex.get(e.index).cm;
  proxyTxs.push(tx(e.height, [ev("message", { action: "/cosmwasm.wasm.v1.MsgExecuteContract", sender: e.source }), execute(dep.proxy), ev("wasm-hops_deposit", { _contract_address: dep.proxy, pending_id: e.index, kind: "deposit", inner: "11".repeat(32), cm, denom: e.denom, amount: e.amount, source: e.source, release_height: e.height })]));
}
const spendEvents = history.filter((e) => e.event === "spend");
if (spendEvents.length !== spends.length) throw new Error(`expected ${spends.length} spends, the viewer shows ${spendEvents.length}`);
spendEvents.forEach((e, i) => {
  const nfs = e.inputs.map((x) => byIndex.get(x).nf);
  const change = e.change === null ? "00".repeat(32) : notes.find((x) => x.index === e.change)?.cm ?? "00".repeat(32);
  proxyTxs.push(tx(e.height, [execute(dep.proxy), ev("wasm-hops_spend", { _contract_address: dep.proxy, kind: spends[i].kind, stmt: 1, nullifiers: nfs.join(","), cm_out: change, denom: e.denom, amount: e.amount, recipient: spends[i].recipient, lane: "instant" }), ev("wasm-hops_spend", { _contract_address: addr("another contract"), kind: "withdraw", nullifiers: nfs.join(","), recipient: addr("not ours") })]));
  // a failed transaction naming the same nullifiers: never a payee
  proxyTxs.push(tx(e.height, [execute(dep.proxy), ev("wasm-hops_spend", { _contract_address: dep.proxy, kind: "withdraw", nullifiers: nfs.join(","), recipient: addr("failed tx") })], 5));
});
proxyTxs.sort((a, b) => Number(a.height) - Number(b.height));
const accountTxs = [tx(callHeight, [execute(acc.address), ev("transfer", { sender: acc.address, recipient: bob, amount: `${RUNE}rune` })])];
const txs = { [dep.proxy]: proxyTxs, [acc.address]: accountTxs };
const balances = {};
for (const a of viewer.spendingAccounts().map((x) => x.address)) balances[a] = [{ denom: "rune", amount: sim.accountBalance(a, "rune") }];
for (const a of viewer.exitAddresses()) balances[a] = [{ denom: "rune", amount: sim.balance(a, "rune") }];

const out = {
  about: "Test fixture: a test account (test secrets) on vault-core's simulated proxy, localnet deployment. Generated by generate.mjs from hops integration 3e9aa75.",
  deployment: { chain_id: dep.chain_id, proxy: dep.proxy, account_code_checksum: dep.account_code_checksum, label: "fixture" },
  deployment_id: dep.id,
  height: Number(sim.height()),
  file,
  fingerprint,
  feeds: JSON.parse(sim.feedRecords()),
  denoms: ["rune"],
  txs,
  balances,
  counterparties: { wallet, exchange, bob, shop, spending: acc.address },
  expect: { status, notes, balances: viewer.balances(), history, accounts: viewer.accounts(), warnings: viewer.warnings(), spendingAccounts: viewer.spendingAccounts(), exitAddresses: viewer.exitAddresses() },
};
const here = path.dirname(fileURLToPath(import.meta.url));
writeFileSync(path.join(here, "view-fixture.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`view-fixture.json: height ${out.height}, ${notes.length} notes, ${history.length} events, nk_check ${status.nk_check}`);
