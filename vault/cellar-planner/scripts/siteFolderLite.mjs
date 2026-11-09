// Builds the public lite planner into a plain folder for uploading to the website host by hand (SiteGround File Manager or FTP). No zip.
//   siteground-upload/cellar-lite/        upload the CONTENTS of this folder into public_html/cellar-lite/ (it includes the hidden .htaccess)
//   siteground-upload/cellar-lite-fill.js the page script for the theme; only needed when it has changed (the site may hold its own edited copy)
// Upload order: assets/ first, then everything else, index.html last, so nobody loads a page whose files are not there yet.
// Run: node scripts/siteFolderLite.mjs   (builds first)
import { execSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
execSync('npx vite build --config vite.lite.config.ts', { cwd: root, stdio: 'inherit' });
const dist = join(root, 'dist-lite');
if (!existsSync(join(dist, 'index.html'))) { console.error('dist-lite/index.html is missing: the build failed.'); process.exit(1); }

const out = join(root, 'siteground-upload');
rmSync(out, { recursive: true, force: true });
const site = join(out, 'cellar-lite');
mkdirSync(site, { recursive: true });
cpSync(dist, site, { recursive: true });
copyFileSync(join(root, 'lite-wordpress', 'cellar-lite.htaccess'), join(site, '.htaccess'));
copyFileSync(join(root, 'lite-wordpress', 'cellar-lite-guide.js'), join(site, 'cellar-lite-guide.js'));
copyFileSync(join(root, 'lite-wordpress', 'cellar-lite-fill.js'), join(out, 'cellar-lite-fill.js'));

const list = (dir, pre = '') => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? list(join(dir, d.name), `${pre}${d.name}/`) : [`${pre}${d.name}`]));
console.log(`\nReady to upload: ${out}`);
for (const f of list(out).sort()) console.log('  ' + f);
