/**
 * The few protobuf messages the viewer sends through CometBFT's `abci_query` (GET, so no CORS
 * preflight and a pinned `height`): CosmWasm's smart query and the bank's balances.
 */

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

function varint(n: number): number[] {
	const out: number[] = [];
	let v = n >>> 0;
	if (n !== v) throw new Error('varint out of range');
	while (v >= 0x80) {
		out.push((v & 0x7f) | 0x80);
		v >>>= 7;
	}
	out.push(v);
	return out;
}

function lenField(field: number, bytes: Uint8Array): number[] {
	return [(field << 3) | 2, ...varint(bytes.length), ...bytes];
}

export function hex(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += b.toString(16).padStart(2, '0');
	return s;
}

/** `cosmwasm.wasm.v1.QuerySmartContractStateRequest { address = 1; query_data = 2 }`. */
export function smartQueryRequest(contract: string, msg: unknown): Uint8Array {
	return Uint8Array.from([...lenField(1, enc.encode(contract)), ...lenField(2, enc.encode(JSON.stringify(msg)))]);
}

/** `cosmos.bank.v1beta1.QueryAllBalancesRequest { address = 1 }` (the default page: 100 coins). */
export function allBalancesRequest(address: string): Uint8Array {
	return Uint8Array.from(lenField(1, enc.encode(address)));
}

interface Field {
	no: number;
	wire: number;
	bytes?: Uint8Array;
}

function* fields(buf: Uint8Array): Generator<Field> {
	let i = 0;
	const readVarint = (): number => {
		let shift = 0;
		let v = 0;
		for (;;) {
			if (i >= buf.length) throw new Error('truncated protobuf');
			const b = buf[i++]!;
			v += (b & 0x7f) * 2 ** shift;
			if (!(b & 0x80)) return v;
			shift += 7;
			if (shift > 63) throw new Error('varint too long');
		}
	};
	while (i < buf.length) {
		const key = readVarint();
		const no = Math.floor(key / 8);
		const wire = key % 8;
		if (wire === 0) {
			readVarint();
			yield { no, wire };
		} else if (wire === 2) {
			const len = readVarint();
			if (i + len > buf.length) throw new Error('truncated protobuf');
			yield { no, wire, bytes: buf.subarray(i, i + len) };
			i += len;
		} else if (wire === 1) {
			i += 8;
			yield { no, wire };
		} else if (wire === 5) {
			i += 4;
			yield { no, wire };
		} else throw new Error(`unsupported wire type ${wire}`);
	}
}

/** `QuerySmartContractStateResponse { data = 1 }`: the contract's JSON answer. */
export function smartQueryResponse(buf: Uint8Array): unknown {
	for (const f of fields(buf)) if (f.no === 1 && f.bytes) return JSON.parse(dec.decode(f.bytes));
	throw new Error('empty smart query answer');
}

/** `QueryAllBalancesResponse { repeated Coin balances = 1 }`, `Coin { denom = 1; amount = 2 }`. */
export function allBalancesResponse(buf: Uint8Array): { denom: string; amount: string }[] {
	const out: { denom: string; amount: string }[] = [];
	for (const f of fields(buf)) {
		if (f.no !== 1 || !f.bytes) continue;
		let denom = '';
		let amount = '';
		for (const c of fields(f.bytes)) {
			if (c.no === 1 && c.bytes) denom = dec.decode(c.bytes);
			if (c.no === 2 && c.bytes) amount = dec.decode(c.bytes);
		}
		if (!/^[0-9]{1,40}$/.test(amount)) throw new Error('bad coin amount');
		out.push({ denom, amount });
	}
	return out;
}

export function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}
