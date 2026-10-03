import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Served by Vault at /room-planner-app/ (built into ../dist/room-planner-app by the root `npm run build`; the Vault page at
 * /room-planner embeds it). The base is also used by the dev server, so standalone dev is http://127.0.0.1:5174/room-planner-app/.
 * The path differs from the page route on purpose: a hard load of /room-planner must reach Vault's router, not this app.
 */
export default defineConfig({
  base: '/room-planner-app/',
  plugins: [react()],
  server: { port: 5174, strictPort: true },
  build: { outDir: '../dist/room-planner-app', emptyOutDir: true, sourcemap: true },
});
