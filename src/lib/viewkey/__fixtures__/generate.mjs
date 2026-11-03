// Makes the test fixtures of the view-key page from a test account on vault-core's simulated proxy (test
// secrets, a localnet deployment; no real key anywhere):
//   view-fixture.json     a view-key file (errata E-66), the proxy's feed records at the tip, the transactions that
//                         executed the proxy and the Spending account, the listed addresses' balances, and what the
//                         SDK's own ViewerService answers for it;
//   history-fixture.json  two history files of another account (errata E-68: held nullifiers left out, and included),
//                         cut before later activity, the feeds at a tip past the cut's block window, the block hashes
//                         around the cut, the proxy's transactions (after the cut too), and the SDK's answers.
//
//   node src/lib/viewkey/__fixtures__/generate.mjs <hops export>   (a `git archive` export of hops release/b-merge
//   4442ac5 with packages/vault-sdk built: wasm-test/ and dist/; see src/lib/vendor/vault-sdk/PROVENANCE.txt)
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hops = process.argv[2];
if (!hops) throw new Error("usage: generate.mjs <hops export>");
const H = await import(path.join(path.resolve(hops), "packages/vault-sdk/test/helpers.mjs"));
const { sdk, wasm, addr, config, localDeployment, RUNE, writeHeader, deposit, opts, proveAndSend } = H;
const here = path.dirname(fileURLToPath(import.meta.url));

function account(S, D) {
  const dep = localDeployment();
  const sim = new wasm.WasmSim(JSON.stringify(dep));
  const v = new sdk.Vault(wasm.WasmVault.fromSecretsForTests(S, D, 0, JSON.stringify(config())));
  const d = v.attach(dep);
  const words = v.phrase().split(" ");
  if (!v.confirmPhraseWords(v.phraseChallenge().map((p) => [p, words[p]]))) throw new Error("phrase gate");
  writeHeader(sim, v, d);
  return { dep, sim, v, d };
}
const unspent = (v, d, amount) => v.notes(d).find((n) => n.amount === String(amount) && n.status.state === "unspent").handle;

// The transactions that executed the proxy, as CometBFT's tx_search returns them (`execute._contract_address`): the
// proxy's `hops_deposit` (admission.rs) and `hops_spend` (private.rs) events with their attributes; plus a failed
// transaction and another contract's event, which the page must ignore. From a view of the account (its notes and
// history) and the recipients of its spends in order.
let txn = 0;
const ev = (type, attrs) => ({ type, attributes: Object.entries(attrs).map(([key, value]) => ({ key, value: String(value), index: true })) });
const execute = (contract) => ev("execute", { _contract_address: contract, msg_index: 0 });
const tx = (height, events, code = 0) => ({ hash: (++txn).toString(16).toUpperCase().padStart(64, "0"), height: String(height), index: 0, tx_result: { code, events } });
function proxyTxs(dep, notes, history, spends) {
  const byIndex = new Map(notes.filter((n) => n.index !== null).map((n) => [n.index, n]));
  const out = [];
  for (const e of history.filter((e) => e.event === "deposit")) {
    out.push(tx(e.height, [ev("message", { action: "/cosmwasm.wasm.v1.MsgExecuteContract", sender: e.source }), execute(dep.proxy), ev("wasm-hops_deposit", { _contract_address: dep.proxy, pending_id: e.index, kind: "deposit", inner: "11".repeat(32), cm: byIndex.get(e.index).cm, denom: e.denom, amount: e.amount, source: e.source, release_height: e.height })]));
  }
  const spendEvents = history.filter((e) => e.event === "spend");
  if (spendEvents.length !== spends.length) throw new Error(`expected ${spends.length} spends, the viewer shows ${spendEvents.length}`);
  spendEvents.forEach((e, i) => {
    const nfs = e.inputs.map((x) => byIndex.get(x).nf);
    const change = e.change === null ? "00".repeat(32) : notes.find((x) => x.index === e.change)?.cm ?? "00".repeat(32);
    out.push(tx(e.height, [execute(dep.proxy), ev("wasm-hops_spend", { _contract_address: dep.proxy, kind: spends[i].kind, stmt: 1, nullifiers: nfs.join(","), cm_out: change, denom: e.denom, amount: e.amount, recipient: spends[i].recipient, lane: "instant" }), ev("wasm-hops_spend", { _contract_address: addr("another contract"), kind: "withdraw", nullifiers: nfs.join(","), recipient: addr("not ours") })]));
    out.push(tx(e.height, [execute(dep.proxy), ev("wasm-hops_spend", { _contract_address: dep.proxy, kind: "withdraw", nullifiers: nfs.join(","), recipient: addr("failed tx") })], 5));
  });
  return out.sort((a, b) => Number(a.height) - Number(b.height));
}

/** What the SDK's own viewer (test module) sees of a view-key file over the simulated chain. */
async function viewOf(sim, dep, file) {
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
  return { viewer, status };
}

// ------------------------------------------------------------------------------------------------- view-key fixture
{
  const { dep, sim, v, d } = account("c1".repeat(32), "c2".repeat(32));
  const wallet = addr("wallet");
  const exchange = addr("exchange");
  const bob = addr("bob");
  const shop = addr("shop");
  sim.credit(wallet, "rune", String(100n * RUNE));
  sim.credit(exchange, "rune", String(100n * RUNE));
  const spends = [];
  deposit(sim, v, d, wallet, 20n * RUNE);
  sim.advance(3n);
  deposit(sim, v, d, wallet, 5n * RUNE);
  sim.advance(3n);
  deposit(sim, v, d, exchange, 30n * RUNE);
  sim.advance(3n);
  proveAndSend(sim, v, v.prepareSpend(d, [unspent(v, d, 20n * RUNE)], String(3n * RUNE), { kind: "withdraw", recipient: bob, home_only: false }, opts(sim)));
  spends.push({ kind: "withdraw", recipient: bob });
  v.sync(d, sim.snapshot());
  sim.advance(3n);
  const acc = v.accountForTask(d, "view");
  proveAndSend(sim, v, v.prepareSpend(d, [unspent(v, d, 17n * RUNE)], String(4n * RUNE), { kind: "fund", account: acc.address, create: acc.params }, opts(sim)));
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
  proveAndSend(sim, v, v.prepareSpend(d, [unspent(v, d, 30n * RUNE)], String(10n * RUNE), { kind: "withdraw", recipient: shop, home_only: false }, opts(sim)));
  spends.push({ kind: "withdraw", recipient: shop });
  v.sync(d, sim.snapshot());
  sim.advance(3n);
  v.freshExitAddress(d);
  v.sync(d, sim.snapshot());

  const disclosure = v.viewKeyDisclosure(d, {}, sim.snapshot(), sim.snapshot(), { min_height: Number(sim.height()) });
  const { file, fingerprint } = v.exportViewKey(d, {}, disclosure.fingerprint);
  const { viewer, status } = await viewOf(sim, dep, file);
  const notes = viewer.notes();
  const history = viewer.history();
  const balances = {};
  for (const a of viewer.spendingAccounts().map((x) => x.address)) balances[a] = [{ denom: "rune", amount: sim.accountBalance(a, "rune") }];
  for (const a of viewer.exitAddresses()) balances[a] = [{ denom: "rune", amount: sim.balance(a, "rune") }];
  const out = {
    about: "Test fixture: a test account (test secrets) on vault-core's simulated proxy, localnet deployment. Generated by generate.mjs from hops release/b-merge 4442ac5.",
    deployment: { chain_id: dep.chain_id, proxy: dep.proxy, account_code_checksum: dep.account_code_checksum, label: "fixture" },
    deployment_id: dep.id,
    height: Number(sim.height()),
    file,
    fingerprint,
    feeds: JSON.parse(sim.feedRecords()),
    denoms: ["rune"],
    txs: { [dep.proxy]: proxyTxs(dep, notes, history, spends), [acc.address]: [tx(callHeight, [execute(acc.address), ev("transfer", { sender: acc.address, recipient: bob, amount: `${RUNE}rune` })])] },
    blocks: {},
    balances,
    counterparties: { wallet, exchange, bob, shop, spending: acc.address },
    expect: { status, notes, balances: viewer.balances(), history, accounts: viewer.accounts(), warnings: viewer.warnings(), spendingAccounts: viewer.spendingAccounts(), exitAddresses: viewer.exitAddresses() },
  };
  writeFileSync(path.join(here, "view-fixture.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(`view-fixture.json: height ${out.height}, ${notes.length} notes, ${history.length} events, nk_check ${status.nk_check}`);
}

// -------------------------------------------------------------------------------------------------- history fixture
{
  const { dep, sim, v, d } = account("e1".repeat(32), "e2".repeat(32));
  const wallet = addr("history wallet");
  const exchange = addr("history exchange");
  const bob = addr("history bob");
  const shop = addr("history shop");
  const carol = addr("history carol after the cut");
  sim.credit(wallet, "rune", String(100n * RUNE));
  sim.credit(exchange, "rune", String(100n * RUNE));
  const spends = [];
  deposit(sim, v, d, wallet, 20n * RUNE);
  sim.advance(2n);
  deposit(sim, v, d, wallet, 5n * RUNE);
  sim.advance(2n);
  deposit(sim, v, d, exchange, 30n * RUNE);
  sim.advance(2n);
  proveAndSend(sim, v, v.prepareSpend(d, [unspent(v, d, 20n * RUNE)], String(3n * RUNE), { kind: "withdraw", recipient: bob, home_only: false }, opts(sim)));
  spends.push({ kind: "withdraw", recipient: bob });
  sim.advance(2n);
  v.sync(d, sim.snapshot());
  // a Spending account funded, then retired before the file leaves (errata E-68 (12) M-2): all its coins back
  const acc = v.accountForTask(d, "act#1");
  proveAndSend(sim, v, v.prepareSpend(d, [unspent(v, d, 17n * RUNE)], String(4n * RUNE), { kind: "fund", account: acc.address, create: acc.params }, opts(sim)));
  spends.push({ kind: "fund", recipient: acc.address });
  sim.advance(2n);
  v.sync(d, sim.snapshot());
  const r = v.prepareReturn(d, acc.index, [{ denom: "rune", amount: String(4n * RUNE) }], Number(sim.height()) + 300);
  const att = JSON.parse(sim.attestReturn(r.account, BigInt(r.nonce), JSON.stringify(r.attest_request.slots)));
  sim.execute(sim.node(), JSON.stringify(v.finishReturn(d, r, "full", att, Number(sim.height()), undefined, 1)), "[]");
  sim.advance(2n);
  v.sync(d, sim.snapshot());
  proveAndSend(sim, v, v.prepareSpend(d, [unspent(v, d, 30n * RUNE)], String(10n * RUNE), { kind: "withdraw", recipient: shop, home_only: false }, opts(sim)));
  spends.push({ kind: "withdraw", recipient: shop });
  sim.advance(2n);
  v.sync(d, sim.snapshot());
  v.accountForTask(d, "act#2");
  const activity = () => [JSON.parse(sim.accountActivity(acc.address)), JSON.parse(sim.accountActivity(acc.address))];

  // the two files, cut at the synced height
  const cut = Number(sim.height());
  const hash = sim.blockHash(sim.height());
  const files = {};
  for (const [name, options] of [["default", {}], ["held_nullifiers", { include_held_nullifiers: true }]]) {
    const disclosure = v.historyDisclosure(d, options, sim.snapshot(), sim.snapshot(), { min_height: cut }, [hash, hash], activity());
    const x = v.exportHistory(d, disclosure.fingerprint);
    files[name] = { file: x.file, fingerprint: x.fingerprint, disclosure: { held: disclosure.held, counts: disclosure.counts, held_nullifiers: disclosure.held_nullifiers } };
  }
  // after the cut: a deposit and a withdrawal to someone else, which no answer may show
  sim.advance(4n);
  deposit(sim, v, d, wallet, 9n * RUNE);
  sim.advance(2n);
  v.sync(d, sim.snapshot());
  proveAndSend(sim, v, v.prepareSpend(d, [unspent(v, d, 9n * RUNE)], String(2n * RUNE), { kind: "withdraw", recipient: carol, home_only: false }, opts(sim)));
  spends.push({ kind: "withdraw", recipient: carol });
  sim.advance(2n);
  v.sync(d, sim.snapshot());
  sim.advance(30n); // past any block window around the cut (at most 24 heights)
  v.sync(d, sim.snapshot());

  // a view key of the same account (only for the proxy events of the fixture and for the leak checks)
  const vk = v.viewKeyDisclosure(d, {}, sim.snapshot(), sim.snapshot(), { min_height: Number(sim.height()) });
  const viewKey = v.exportViewKey(d, {}, vk.fingerprint).file;
  const { viewer: vkViewer } = await viewOf(sim, dep, viewKey);
  const notes = vkViewer.notes();
  const history = vkViewer.history();

  const tip = Number(sim.height());
  const blocks = {};
  for (let h = Math.max(1, cut - 40); h <= tip; h++) blocks[h] = sim.blockHash(BigInt(h)).toUpperCase();
  const at = () => [JSON.parse(sim.snapshot()), JSON.parse(sim.snapshot())];
  const seed = "a7".repeat(32);
  const expect = {};
  for (const [name, f] of Object.entries(files)) {
    const viewer = new sdk.ViewerService({ deployment: dep, windowSeed: async () => seed, readSnapshot: async () => at()[0], readSnapshots: async () => at(), blockHashes: async (h) => [sim.blockHash(BigInt(h)), sim.blockHash(BigInt(h))] });
    viewer.openHistory(f.file);
    const status = await viewer.verifyHistory();
    expect[name] = { status, items: viewer.historyItems(), totals: viewer.historyTotals(), accounts: viewer.historyAccounts(), warnings: viewer.historyWarnings(), window: await sdk.historyCutWindow(seed, cut) };
  }
  const out = {
    about: "Test fixture: history files (errata E-68) of a test account (test secrets) on vault-core's simulated proxy, localnet deployment. Generated by generate.mjs from hops release/b-merge 4442ac5.",
    deployment: { chain_id: dep.chain_id, proxy: dep.proxy, account_code_checksum: dep.account_code_checksum, label: "fixture" },
    deployment_id: dep.id,
    cut,
    cut_block_hash: hash,
    height: tip,
    files,
    feeds: JSON.parse(sim.feedRecords()),
    denoms: ["rune"],
    blocks,
    txs: { [dep.proxy]: proxyTxs(dep, notes, history, spends) },
    balances: {},
    counterparties: { wallet, exchange, bob, shop, spending: acc.address, carol_after_cut: carol },
    after_cut: { notes: notes.filter((n) => n.index !== null && history.some((e) => e.event === "deposit" && e.index === n.index && e.height > cut)).map((n) => n.cm), payee: carol },
    view_key_values: (() => { const j = JSON.parse(viewKey); return { rk: j.rk, nk: j.nk, ck: j.ck }; })(),
    expect,
  };
  writeFileSync(path.join(here, "history-fixture.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(`history-fixture.json: cut ${cut}, tip ${tip}, ${expect.default.items.length} items, verified ${expect.default.status.verified}, window ${expect.default.window}`);
}
