// Test stand-in for SvelteKit's `$env/dynamic/private`.
export const env: Record<string, string | undefined> = process.env;
