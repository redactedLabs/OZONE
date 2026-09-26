// Marks dist/cjs as CommonJS so `require()` works next to the ESM build.
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('../dist/cjs/package.json', import.meta.url), JSON.stringify({ type: 'commonjs' }) + '\n');
