import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Cellar Planner as its own Vite app. NOT yet wired into Vault's build, nav or feature flags (that integration comes later, in its own commits):
 * run it with `npm run dev` (port 5176). `base` is where Vault will serve it.
 */
export default defineConfig({
  base: '/cellar-planner-app/',
  plugins: [react()],
  resolve: { alias: { '@planner-core': path.resolve(here, '../planner-core/src') }, dedupe: ['react', 'react-dom', 'zustand', 'konva'] },
  // Shepherd is loaded on first use; pre-bundling it stops the dev server reloading the page the first time the tour opens
  optimizeDeps: { include: ['shepherd.js'] },
  server: { port: 5176, strictPort: true, fs: { allow: ['..'] } },
  build: { outDir: '../dist/cellar-planner-app', emptyOutDir: true, sourcemap: true },
});
