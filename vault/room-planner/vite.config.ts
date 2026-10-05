import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Served by Vault at /room-planner-app/ (built into ../dist/room-planner-app by the root `npm run build`; the Vault page at
 * /room-planner embeds it). The base is also used by the dev server, so standalone dev is http://127.0.0.1:5174/room-planner-app/.
 * The path differs from the page route on purpose: a hard load of /room-planner must reach Vault's router, not this app.
 *
 * `@planner-core` is the code shared with Garden Planner (../planner-core). Libraries are de-duplicated so the shared code and this
 * app always use ONE copy of three / react / zustand (two copies of three break instanceof checks).
 */
export default defineConfig({
  base: '/room-planner-app/',
  plugins: [react()],
  resolve: {
    alias: { '@planner-core': path.resolve(here, '../planner-core/src') },
    dedupe: ['three', 'react', 'react-dom', 'zustand', 'konva', 'pdf-lib'],
  },
  server: { port: 5174, strictPort: true, fs: { allow: ['..'] } },
  build: { outDir: '../dist/room-planner-app', emptyOutDir: true, sourcemap: true },
});
