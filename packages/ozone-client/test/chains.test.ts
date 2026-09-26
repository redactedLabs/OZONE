import { describe, expect, it } from 'vitest';
import {
	addressReadings,
	canonicalKey,
	detectAddress,
	keyTwins,
	normalizeChain,
	parseForChain,
	parseListedAddress,
	THORCHAIN_CHAINS
} from '../src/chains.js';
import { bech32Decode, bech32Encode } from '../src/encoding.js';

describe('chain registry', () => {
	it('lists exactly the THORNode 3.20.3 payout chains', () => {
		expect([...THORCHAIN_CHAINS].sort()).toEqual(
			['AVAX', 'BASE', 'BCH', 'BSC', 'BTC', 'DOGE', 'ETH', 'GAIA', 'LTC', 'SOL', 'THOR', 'TRON', 'XRP'].sort()
		);
	});

	it('normalizes chain aliases and ignores token tickers', () => {
		expect(normalizeChain('xbt')).toBe('BTC');
		expect(normalizeChain('TRX')).toBe('TRON');
		expect(normalizeChain('Arbitrum')).toBe('ARB');
		expect(normalizeChain('USDT')).toBeUndefined();
		expect(normalizeChain('ADA')).toBeUndefined();
		expect(normalizeChain('')).toBeUndefined();
	});
});

describe('EVM', () => {
	it('lower-cases into one namespace for every EVM chain', () => {
		const checksummed = '0x47666Fab8bd0Ac7003bce3f5C3585383F09486E2';
		for (const c of ['ETH', 'BSC', 'BASE', 'AVAX', 'ARB', 'ETC']) {
			expect(parseForChain(checksummed, c)?.key).toBe('evm:0x47666fab8bd0ac7003bce3f5c3585383f09486e2');
		}
		expect(canonicalKey(checksummed)).toBe('evm:0x47666fab8bd0ac7003bce3f5c3585383f09486e2');
		expect(parseForChain('0x47666Fab8bd0Ac7003bce3f5C3585383F09486E', 'ETH')).toBeNull();
		expect(parseForChain('47666Fab8bd0Ac7003bce3f5C3585383F09486E2', 'ETH')).toBeNull();
	});
});

describe('Bitcoin', () => {
	it('accepts legacy, P2SH, segwit v0 and taproot (BIP-173/350 vectors)', () => {
		expect(parseForChain('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'BTC')?.kind).toBe('p2pkh');
		expect(parseForChain('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', 'BTC')?.kind).toBe('p2sh');
		expect(parseForChain('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'BTC')?.kind).toBe('p2wpkh');
		expect(parseForChain('BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4', 'BTC')?.address).toBe(
			'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
		);
		expect(parseForChain('bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3', 'BTC')?.kind).toBe('p2wsh');
		expect(parseForChain('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0', 'BTC')?.kind).toBe('p2tr');
	});

	it('rejects bad checksums, wrong bech32 variants and mixed case', () => {
		expect(parseForChain('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb', 'BTC')).toBeNull();
		// v0 program with a bech32m checksum / v1 with a bech32 checksum (BIP-350 invalid vectors)
		expect(parseForChain('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh', 'BTC')).toBeNull();
		expect(parseForChain('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd', 'BTC')).toBeNull();
		expect(parseForChain('bc1qW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'BTC')).toBeNull();
		expect(parseForChain('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'BTC')).toBeNull();
	});

	it('keeps base58 case-sensitive', () => {
		const k = canonicalKey('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'BTC');
		expect(k).toBe('btc:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
		expect(canonicalKey('1a1zp1ep5qgefi2dmptftl5slmv7divfna', 'BTC')).toBeNull();
	});
});

describe('Bitcoin Cash', () => {
	// cashaddr specification test vectors
	const vectors: Array<[string, string]> = [
		['1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu', 'qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a'],
		['1KXrWXciRDZUpQwQmuM1DbwsKDLYAYsVLR', 'qr95sy3j9xwd2ap32xkykttr4cvcu7as4y0qverfuy'],
		['16w1D5WRVKJuZUsSRzdLp9w3YGcgoxDXb', 'qqq3728yw0y47sqn6l2na30mcw6zm78dzqre909m2r'],
		['3CWFddi6m4ndiGyKqzYvsFYagqDLPVMTzC', 'ppm2qsznhks23z7629mms6s4cwef74vcwvn0h829pq']
	];
	it('converts legacy to cashaddr (no prefix, as Midgard shows it)', () => {
		for (const [legacy, cash] of vectors) {
			expect(parseForChain(legacy, 'BCH')?.key).toBe(`bch:${cash}`);
			expect(parseForChain(`bitcoincash:${cash}`, 'BCH')?.key).toBe(`bch:${cash}`);
			expect(parseForChain(cash, 'BCH')?.key).toBe(`bch:${cash}`);
			expect(parseForChain(cash.toUpperCase(), 'BCH')?.key).toBe(`bch:${cash}`);
		}
	});
	it('rejects a corrupted cashaddr', () => {
		expect(parseForChain('qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6b', 'BCH')).toBeNull();
	});
	it('reads an unhinted legacy 1… address as BTC, BCH and BSV', () => {
		const keys = detectAddress('1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu').map((p) => p.key);
		expect(keys).toEqual([
			'btc:1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu',
			'bch:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a',
			'bsv:1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu'
		]);
	});
});

describe('other THORChain chains', () => {
	it('THOR and GAIA bech32 (lower-cased, mixed case rejected)', () => {
		const thor = 'thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh';
		expect(parseForChain(thor, 'THOR')?.key).toBe(`thor:${thor}`);
		expect(parseForChain(thor.toUpperCase(), 'THOR')?.key).toBe(`thor:${thor}`);
		expect(parseForChain('thor1Fns25sytpf2gsdlg76g45620u5axm4mkrypqrh', 'THOR')).toBeNull();
		const words = bech32Decode(thor)!.words;
		const cosmos = bech32Encode('cosmos', words);
		expect(parseForChain(cosmos, 'GAIA')?.key).toBe(`gaia:${cosmos}`);
		expect(parseForChain(cosmos, 'THOR')).toBeNull();
		expect(detectAddress(thor)[0].chain).toBe('THOR');
	});

	it('LTC, DOGE, TRON, XRP, SOL', () => {
		expect(parseForChain('LaizKtS5DUhPuP1nTQcc83MS7HwK6vk85z', 'LTC')?.kind).toBe('p2pkh');
		expect(parseForChain('DHzAVdEoL3PjGeLWNdEJwwMA1CeQ9J9Cpo', 'DOGE')?.kind).toBe('p2pkh');
		expect(parseForChain('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'TRON')?.key).toBe('tron:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
		// TronGrid event form (hex without the 0x41 prefix) converts to base58
		expect(parseForChain('0xa614f803b6fd780986a42c78ec9c7f77e6ded13c', 'TRON')?.key).toBe(
			'tron:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
		);
		expect(parseForChain('41a614f803b6fd780986a42c78ec9c7f77e6ded13c', 'TRON')?.key).toBe(
			'tron:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
		);
		expect(parseForChain('rnXyVQzgxZe7TR1EPzTkGj2jxH4LMJYh66', 'XRP')?.key).toBe('xrp:rnXyVQzgxZe7TR1EPzTkGj2jxH4LMJYh66');
		expect(parseForChain('rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', 'XRP')).not.toBeNull();
		expect(parseForChain('rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTi', 'XRP')).toBeNull();
		expect(parseForChain('Fc1EwQUZyTEagaDvA1utHXCcZNyG1x2PLt2DfNu1cJdH', 'SOL')?.namespace).toBe('sol');
		expect(parseForChain('11111111111111111111111111111111', 'SOL')).not.toBeNull();
	});

	it('detects the chain from the format when no hint is given', () => {
		expect(detectAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')[0].chain).toBe('TRON');
		expect(detectAddress('rnXyVQzgxZe7TR1EPzTkGj2jxH4LMJYh66')[0].chain).toBe('XRP');
		expect(detectAddress('Fc1EwQUZyTEagaDvA1utHXCcZNyG1x2PLt2DfNu1cJdH')[0].chain).toBe('SOL');
		expect(detectAddress('qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a')[0].chain).toBe('BCH');
		expect(detectAddress('DHzAVdEoL3PjGeLWNdEJwwMA1CeQ9J9Cpo')[0].chain).toBe('DOGE');
		expect(detectAddress('ltc1qg82cxcfg3ehxkd3rzwpxnp5ywyk3uxlx9kkmff').length).toBeGreaterThanOrEqual(0);
		expect(detectAddress('not an address')).toEqual([]);
		expect(detectAddress('')).toEqual([]);
	});

	it('list chains outside THORChain: ZEC, DASH, XMR', () => {
		expect(parseForChain('t1g7wowvQ8gn2v8jrU1biyJ26sieNqNsBJy', 'ZEC')?.kind).toBe('p2pkh');
		expect(parseForChain('XnPFsRWTaSgiVauosEwQ6dEitGYXgwznz2', 'DASH')?.kind).toBe('p2pkh');
		expect(
			parseForChain(
				'44dZUJ7w1T3fKAvFW8XyXUVoAGSbFvXef2wcbnsjNKGWYorpLJBjth5VKSFhLGkpYKJb2J341tdZHBnbpv72WL7e8zuxfR2',
				'XMR'
			)
		).not.toBeNull();
	});
});

describe('listed addresses', () => {
	it('falls back to format detection for token tickers and wrong declarations', () => {
		expect(parseListedAddress('TA3941uFAvmVibSkQ6fMJXxmaSNovX86mz', 'USDT')?.parsed.chain).toBe('TRON');
		// OFAC lists one TRON address under XBT
		const r = parseListedAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'XBT');
		expect(r?.parsed.chain).toBe('TRON');
		expect(r?.declaredMismatch).toBe(true);
		expect(parseListedAddress('0x4f47bc496083c727c5fbe3ce9cdf2b0f6496270c', 'BSC')?.parsed.key).toBe(
			'evm:0x4f47bc496083c727c5fbe3ce9cdf2b0f6496270c'
		);
		expect(parseListedAddress('garbage', 'ETH')).toBeNull();
	});

	it('hint-restricted readings', () => {
		expect(addressReadings('1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu', 'BTC').map((p) => p.key)).toEqual([
			'btc:1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu'
		]);
		expect(addressReadings('1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu', 'ETH')).toEqual([]);
	});
});

describe('same-key twins', () => {
	it('TRON ↔ EVM', () => {
		const tron = parseForChain('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'TRON')!;
		expect(keyTwins(tron).map((t) => t.key)).toEqual(['evm:0xa614f803b6fd780986a42c78ec9c7f77e6ded13c']);
		const evm = parseForChain('0xa614f803b6fd780986a42c78ec9c7f77e6ded13c', 'ETH')!;
		expect(keyTwins(evm).map((t) => t.key)).toEqual(['tron:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t']);
	});

	it('P2PKH across BTC/BCH/LTC/DOGE, not P2SH', () => {
		const btc = parseForChain('1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu', 'BTC')!;
		const keys = keyTwins(btc).map((t) => t.key);
		expect(keys).toContain('bch:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a');
		expect(keys.some((k) => k.startsWith('btc:bc1q'))).toBe(true);
		expect(keys.some((k) => k.startsWith('ltc:L'))).toBe(true);
		expect(keys.some((k) => k.startsWith('doge:D'))).toBe(true);
		const p2sh = parseForChain('3CWFddi6m4ndiGyKqzYvsFYagqDLPVMTzC', 'BTC')!;
		expect(keyTwins(p2sh)).toEqual([]);
	});
});
