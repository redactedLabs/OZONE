import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit/integration tests run without SvelteKit: engine and client code are
// plain TypeScript. `$lib`/`$server` aliases are mapped for route helpers.
export default defineConfig({
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
			$server: fileURLToPath(new URL('./src/lib/server', import.meta.url)),
			$ozone: fileURLToPath(new URL('./packages/ozone-client/src', import.meta.url)),
			$engine: fileURLToPath(new URL('./packages/ozone-engine/src', import.meta.url)),
			'$env/dynamic/private': fileURLToPath(new URL('./src/lib/server/ozone/__test__/env.ts', import.meta.url))
		}
	},
	test: {
		include: ['packages/**/test/**/*.test.ts', 'src/**/*.test.ts'],
		environment: 'node',
		pool: 'forks',
		poolOptions: { forks: { maxForks: 3, minForks: 1 } },
		testTimeout: 60_000,
		hookTimeout: 60_000
	}
});
