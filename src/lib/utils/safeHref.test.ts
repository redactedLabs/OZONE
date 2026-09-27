import { describe, expect, it } from 'vitest';
import { safeHref } from './safeHref';

describe('safeHref', () => {
	it('passes through http(s) URLs unchanged', () => {
		expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
		expect(safeHref('http://example.com/a')).toBe('http://example.com/a');
		expect(safeHref('HTTPS://EXAMPLE.COM')).toBe('HTTPS://EXAMPLE.COM');
	});

	it('rejects every other scheme', () => {
		expect(safeHref('javascript:alert(document.domain)')).toBeUndefined();
		expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined();
		expect(safeHref('vbscript:msgbox(1)')).toBeUndefined();
		expect(safeHref('file:///etc/passwd')).toBeUndefined();
		expect(safeHref('JaVaScRiPt:alert(1)')).toBeUndefined(); // case-insensitive scheme parsing
	});

	it('rejects malformed or relative values instead of guessing', () => {
		expect(safeHref('/relative/path')).toBeUndefined();
		expect(safeHref('not a url at all')).toBeUndefined();
		expect(safeHref('')).toBeUndefined();
		expect(safeHref(null)).toBeUndefined();
		expect(safeHref(undefined)).toBeUndefined();
	});
});
