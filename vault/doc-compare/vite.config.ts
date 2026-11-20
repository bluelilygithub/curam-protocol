import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Standard build: static files with relative paths, served by Vault at /doc-compare-app/ (built into ../dist/doc-compare-app by the root
 * `npm run build`; /doc-compare embeds it). `--mode single`: one self-contained dist/index.html that opens from disk.
 * Workers (compare + pdf.js) are imported with `?worker&inline`, so both builds need no separate worker files.
 */
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react()],
  resolve: {
    alias: {
      // the themed tooltip shared with the other Vault apps (see planner-core/README.md)
      '@planner-core': path.resolve(here, '../planner-core/src'),
      // the (i) text and guide ids, shared with Vault's guide chat (client/src/pages/docCompare/docCompareTools.mjs)
      '@vault-client': path.resolve(here, '../client/src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: { port: 5178, strictPort: true, fs: { allow: ['..'] } },
  build: mode === 'single'
    ? { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 8000 }
    : { outDir: '../dist/doc-compare-app', emptyOutDir: true, sourcemap: true, chunkSizeWarningLimit: 3000 },
}));
