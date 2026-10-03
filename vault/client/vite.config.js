import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
  optimizeDeps: {
    include: ['@react-pdf/renderer'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true, // Browser Agent's /api/browser-agent/ws upgrade needs this forwarded too
      },
      // Room Planner dev server (`npm run dev` inside room-planner/, port 5174, base /room-planner-app/)
      '/room-planner-app': {
        target: 'http://127.0.0.1:5174',
        changeOrigin: true,
        ws: true, // Vite HMR
      },
      '/tb': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        timeout: 600000,
        proxyTimeout: 600000,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../dist'),
    emptyOutDir: true,
  },
});
