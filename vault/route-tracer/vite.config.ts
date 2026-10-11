import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Served by Vault at /route-tracer-app/ (built into ../dist/route-tracer-app by the root `npm run build`; /route-tracer embeds it). */
export default defineConfig({
  base: '/route-tracer-app/',
  plugins: [react()],
  // `npm run dev` here; point /api at a running Vault server (default local port 3001, override with VAULT_API)
  server: { port: 5177, strictPort: true, proxy: { '/api': process.env.VAULT_API ?? 'http://localhost:3001' } },
  build: { outDir: '../dist/route-tracer-app', emptyOutDir: true, sourcemap: true, chunkSizeWarningLimit: 1500 },
});
