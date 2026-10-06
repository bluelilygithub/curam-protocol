// Writes examples/test-case-1.cellar.json from the app's own test case, so the file you can open with "Open file" never drifts from the button.
// Run with:  npx vite-node scripts/writeExample.mjs   (or `npm run example`)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serializeApp, testCaseProject } from '../src/app/model.ts';

writeFileSync(join(import.meta.dirname, '..', 'examples', 'test-case-1.cellar.json'), serializeApp(testCaseProject()) + '\n');
console.log('wrote examples/test-case-1.cellar.json');
