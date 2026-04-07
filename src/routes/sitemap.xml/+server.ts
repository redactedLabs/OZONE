import type { RequestHandler } from './$types';

const SITE = 'https://ozone.redacted.gg';

const pages = [
	{ path: '/', priority: '1.0', changefreq: 'daily' },
	{ path: '/certificate', priority: '0.9', changefreq: 'weekly' },
	{ path: '/history', priority: '0.9', changefreq: 'weekly' },
	{ path: '/banned', priority: '0.8', changefreq: 'daily' },
	{ path: '/addresses', priority: '0.7', changefreq: 'daily' },
	{ path: '/api-docs', priority: '0.8', changefreq: 'monthly' },
	{ path: '/open-source', priority: '0.7', changefreq: 'weekly' },
];

export const GET: RequestHandler = async () => {
	const today = new Date().toISOString().split('T')[0];

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url>
    <loc>${SITE}${p.path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

	return new Response(xml, {
		headers: {
			'Content-Type': 'application/xml',
			'Cache-Control': 'max-age=3600',
		},
	});
};
