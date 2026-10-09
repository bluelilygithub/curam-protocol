import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The lite page is built from lite.html but must be served as index.html, so the folder works at any path. */
const asIndex = (): Plugin => ({
  name: 'lite-as-index',
  enforce: 'post',
  generateBundle(_, bundle) {
    const page = bundle['lite.html'];
    if (page) { page.fileName = 'index.html'; bundle['index.html'] = page; delete bundle['lite.html']; }
  },
});

/**
 * The public lite tool as its own static bundle: relative base (works at any path, for example public_html/cellar-lite/ on the website's host),
 * no Vault login and no API calls. Output: cellar-planner/dist-lite/. Dev: `npm run dev:lite` (port 5177).
 */
export default defineConfig({
  base: './',
  cacheDir: 'node_modules/.vite-lite', // its own dependency cache, so running it beside the full planner's dev server never clashes
  plugins: [react(), asIndex()],
  resolve: { alias: { '@planner-core': path.resolve(here, '../planner-core/src') }, dedupe: ['react', 'react-dom', 'zustand', 'konva'] },
  server: { port: 5177, strictPort: true, fs: { allow: ['..'] }, open: '/lite.html' },
  build: { outDir: 'dist-lite', emptyOutDir: true, rollupOptions: { input: path.resolve(here, 'lite.html') } },
});
