// Packs the built lite tool (dist-lite/) into cellar-lite-upload.zip, ready to extract into the website's cellar-lite folder.
//  - forward-slash paths (Windows' own zip tool writes backslashes, which extract wrongly on a Linux host)
//  - adds lite-wordpress/cellar-lite.htaccess as ".htaccess" so index.html is never cached for long
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

const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
const out = join(root, 'cellar-lite-upload.zip');
writeFileSync(out, bytes);
const names = Object.keys(zip.files).sort();
console.log(`wrote ${out} (${Math.round(bytes.length / 1024)} KB, ${names.length} files)`);
for (const n of names) console.log('  ' + n);
