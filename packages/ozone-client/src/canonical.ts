/**
 * Deterministic JSON (RFC 8785 / JCS style for the subset Ozone uses):
 * object keys sorted by UTF-16 code units, no whitespace, `undefined`
 * members dropped, numbers in ECMAScript shortest form. Signatures are
 * always computed over this serialization, never over pretty-printed JSON.
 */
export function canonicalJson(value: unknown): string {
	return serialize(value);
}

function serialize(value: unknown): string {
	if (value === null) return 'null';
	switch (typeof value) {
		case 'boolean':
			return value ? 'true' : 'false';
		case 'number':
			if (!Number.isFinite(value)) throw new Error('canonicalJson: non-finite number');
			return JSON.stringify(value);
		case 'string':
			return JSON.stringify(value);
		case 'bigint':
			throw new Error('canonicalJson: bigint is not supported');
		case 'object': {
			if (Array.isArray(value)) {
				return '[' + value.map((v) => (v === undefined ? 'null' : serialize(v))).join(',') + ']';
			}
			if (value instanceof Uint8Array) throw new Error('canonicalJson: bytes must be encoded first');
			const obj = value as Record<string, unknown>;
			const keys = Object.keys(obj)
				.filter((k) => obj[k] !== undefined)
				.sort();
			return '{' + keys.map((k) => JSON.stringify(k) + ':' + serialize(obj[k])).join(',') + '}';
		}
		default:
			throw new Error(`canonicalJson: unsupported type ${typeof value}`);
	}
}
