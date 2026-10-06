import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { ocrAssets } from '../planner-core/vite/ocrAssets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Served by Vault at /garden-planner-app/ (built into ../dist/garden-planner-app by the root `npm run build`; the Vault page at
 * /garden-planner embeds it). Same arrangement as Room Planner. `@planner-core` is the code shared between the planners.
 */
export default defineConfig({
  base: '/garden-planner-app/',
  plugins: [react(), ocrAssets({ from: here })],
  resolve: {
    alias: {
      '@planner-core': path.resolve(here, '../planner-core/src'),
      // Vault's existing spoken-number parser ("two point five" -> 2.5), reused for number fields
      '@vault-client': path.resolve(here, '../client/src'),
    },
    dedupe: ['three', 'react', 'react-dom', 'zustand', 'konva', 'tesseract.js', 'pdf-lib'],
  },
  server: { port: 5175, strictPort: true, fs: { allow: ['..'] } },
  build: { outDir: '../dist/garden-planner-app', emptyOutDir: true, sourcemap: true },
});
