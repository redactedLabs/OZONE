/**
 * Tiny, allocation-light helpers for the official list XML files. The files
 * are large (OFAC SDN 29 MB, UK 22 MB, EU 26 MB) and regular; scanning
 * element blocks with indexOf is far cheaper than building a DOM and is
 * robust to schema additions.
 */

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
	if (!s.includes('&')) return s;
	return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, body: string) => {
		if (body[0] === '#') {
			const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : m;
		}
		return NAMED[body] ?? m;
	});
}

/** Yields the inner text of every `<tag …>…</tag>` block (non-nested tags). */
export function* blocks(xml: string, tag: string): Generator<string> {
	const open = `<${tag}`;
	const close = `</${tag}>`;
	let i = 0;
	for (;;) {
		let start = xml.indexOf(open, i);
		if (start < 0) return;
		const after = xml.charCodeAt(start + open.length);
		// make sure we matched `<tag>` or `<tag ` and not `<tagOther`
		if (after !== 62 /* > */ && after !== 32 /* space */ && after !== 10 && after !== 13 && after !== 9) {
			i = start + open.length;
			continue;
		}
		const gt = xml.indexOf('>', start);
		if (gt < 0) return;
		if (xml.charCodeAt(gt - 1) === 47 /* / */) {
			i = gt + 1;
			yield '';
			continue;
		}
		const end = xml.indexOf(close, gt);
		if (end < 0) return;
		start = gt + 1;
		yield xml.slice(start, end);
		i = end + close.length;
	}
}

/** Full opening tags `<tag attr="…">` with their attributes, plus inner text. */
export function* elements(xml: string, tag: string): Generator<{ attrs: Record<string, string>; inner: string }> {
	const re = new RegExp(`<${tag}(\\s[^>]*)?(/>|>([\\s\\S]*?)</${tag}>)`, 'g');
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml))) {
		yield { attrs: parseAttrs(m[1] ?? ''), inner: m[3] ?? '' };
	}
}

export function parseAttrs(s: string): Record<string, string> {
	const out: Record<string, string> = {};
	const re = /([\w:-]+)\s*=\s*"([^"]*)"/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(s))) out[m[1]] = decodeEntities(m[2]);
	return out;
}

/** First `<tag>text</tag>` inside `xml` (decoded, trimmed), or undefined. */
export function firstText(xml: string, tag: string): string | undefined {
	const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`);
	const m = re.exec(xml);
	return m ? decodeEntities(m[1]).trim() : undefined;
}

export function allTexts(xml: string, tag: string): string[] {
	const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
	const out: string[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml))) out.push(decodeEntities(m[1]).trim());
	return out;
}

/** Strips tags (for free-text scanning). */
export function stripTags(s: string): string {
	return decodeEntities(s.replace(/<[^>]+>/g, ' '));
}
