// Writes the generated fixture pairs to tests/fixtures/out/<case>/ (gitignored) so they can be dropped into the UI.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixtures } from '../tests/fixtures/generate.mjs';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'out');
await rm(outDir, { recursive: true, force: true });
for (const f of await buildFixtures()) {
  const dir = path.join(outDir, f.name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, f.original.name), f.original.bytes);
  await writeFile(path.join(dir, f.edited.name), f.edited.bytes);
  await writeFile(path.join(dir, 'expected.json'), JSON.stringify(f.expect, null, 2));
}
console.log(`Fixtures written to ${outDir}`);
