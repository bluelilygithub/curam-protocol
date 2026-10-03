import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Standalone app: not mounted into Vault, so it gets its own dev port.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true },
  build: { outDir: 'dist', sourcemap: true },
});
