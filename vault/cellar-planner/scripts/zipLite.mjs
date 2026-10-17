// Packs the built lite tool (dist-lite/) into cellar-lite-upload.zip, ready to extract into the website's cellar-lite folder.
//  - forward-slash paths (Windows' own zip tool writes backslashes, which extract wrongly on a Linux host)
//  - adds lite-wordpress/cellar-lite.htaccess as ".htaccess" so index.html is never cached for long
//  - adds the help chat's page script (cellar-lite-guide.js) beside index.html
// Run: npm run zip:lite   (builds first)
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const here = import.meta.dirname;
const root = join(here, '..');
const JSZip = createRequire(join(root, '..', 'package.json'))('jszip');
const dist = join(root, 'dist-lite');
if (!existsSync(join(dist, 'index.html'))) { console.error('dist-lite/index.html is missing: run npm run build:lite first.'); process.exit(1); }

const zip = new JSZip();
const walk = (dir) => { for (const name of readdirSync(dir)) { const full = join(dir, name); if (statSync(full).isDirectory()) walk(full); else zip.file(relative(dist, full).split(sep).join('/'), readFileSync(full)); } };
walk(dist);
zip.file('.htaccess', readFileSync(join(root, 'lite-wordpress', 'cellar-lite.htaccess')));
// the help chat's page script travels in the same zip, so one upload updates it too. The page loads it by address, for example
// <script src="/cellar-lite/cellar-lite-guide.js"></script> (docs/cellar-planner.md). cellar-lite-fill.js is NOT included: the site keeps its own edited copy.
zip.file('cellar-lite-guide.js', readFileSync(join(root, 'lite-wordpress', 'cellar-lite-guide.js')));

const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
const out = join(root, 'cellar-lite-upload.zip');
writeFileSync(out, bytes);
const names = Object.keys(zip.files).sort();
console.log(`wrote ${out} (${Math.round(bytes.length / 1024)} KB, ${names.length} files)`);
for (const n of names) console.log('  ' + n);
