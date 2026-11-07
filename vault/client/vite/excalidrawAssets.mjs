// Vite plugin: serves and builds Excalidraw's fonts from our own origin under `<base>excalidraw-assets/fonts/`. Without it Excalidraw fetches
// them from a public CDN (esm.sh), which is a third-party host we would have to allow in the production Content Security Policy, and which
// would make the drawing tool depend on someone else being up. The page sets `window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/'` before
// the editor is loaded (client/src/pages/drawings/loadExcalidraw.js). Same idea as planner-core/vite/ocrAssets.mjs.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const MIME = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };

export function excalidrawAssets({ from }) {
  // the package's `exports` hide its package.json, so find the folder by walking up to the nearest node_modules that has it
  const fontsDir = () => {
    for (let dir = from; ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, 'node_modules', '@excalidraw', 'excalidraw', 'dist', 'prod', 'fonts');
      if (existsSync(candidate)) return candidate;
      if (path.dirname(dir) === dir) throw new Error('@excalidraw/excalidraw is not installed (npm install)');
    }
  };
  const walk = (dir, rel = '') => readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full, `${rel}${name}/`) : [`${rel}${name}`];
  });
  let base = '/';
  return {
    name: 'excalidraw-assets',
    configResolved(cfg) { base = cfg.base.endsWith('/') ? cfg.base : cfg.base + '/'; },
    configureServer(server) {
      server.middlewares.use((req2, res, next) => {
        const url = decodeURIComponent((req2.url ?? '').split('?')[0]);
        const prefix = [`${base}excalidraw-assets/fonts/`, '/excalidraw-assets/fonts/'].find((p) => url.startsWith(p));
        if (!prefix) return next();
        const rel = url.slice(prefix.length);
        const file = path.join(fontsDir(), rel);
        if (rel.includes('..') || !file.startsWith(fontsDir()) || !existsSync(file) || statSync(file).isDirectory()) return next();
        res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      const dir = fontsDir();
      for (const rel of walk(dir)) this.emitFile({ type: 'asset', fileName: `excalidraw-assets/fonts/${rel}`, source: readFileSync(path.join(dir, rel)) });
    },
  };
}
