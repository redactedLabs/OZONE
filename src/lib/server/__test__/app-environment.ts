// Test stand-in for SvelteKit's `$app/environment` (this suite runs without
// the SvelteKit runtime — see vitest.config.ts). Default to "not dev": tests
// that need the dev fallback path override this with `vi.doMock`.
export const dev = false;
export const building = false;
export const browser = false;
export const version = 'test';
