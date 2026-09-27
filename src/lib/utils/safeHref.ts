/**
 * Only http(s) is ever safe to bind into an <a href>. Most ref/source URLs
 * here are Ozone's own constants or explorer templates, but the EU FSF
 * source derives its ref from upstream feed text (see
 * packages/ozone-engine/src/sources/eu.ts), and that value flows — through
 * oz_entries.ref_url, a signed snapshot's reason.ref, and an issued
 * certificate's stored document — into every place that renders a
 * "source ↗" link. With no scheme check, a stored `javascript:`/`data:`
 * value becomes click-to-execute script on this origin for any visitor.
 * Every href={...} built from stored data goes through this first.
 */
export function safeHref(url: string | null | undefined): string | undefined {
	if (!url) return undefined;
	try {
		const { protocol } = new URL(url);
		return protocol === 'https:' || protocol === 'http:' ? url : undefined;
	} catch {
		return undefined;
	}
}
