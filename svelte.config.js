import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			runtime: 'nodejs24.x'
		}),
		alias: {
			$components: 'src/lib/components',
			$server: 'src/lib/server',
			// Ozone client (snapshot verification + local screening) and engine
			// (ingestion, THORChain tracing, snapshot publishing) — plain TS packages
			$ozone: 'packages/ozone-client/src',
			$engine: 'packages/ozone-engine/src'
		}
	}
};

export default config;
