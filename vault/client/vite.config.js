import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { ocrAssets } from '../planner-core/vite/ocrAssets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  plugins: [react(), ocrAssets({ from: __dirname })],
  resolve: {
    // planner-core: code shared with the Room / Garden Planner apps (speech recognition, OCR). Libraries stay de-duplicated to Vault's copy.
    alias: { '@planner-core': path.resolve(__dirname, '../planner-core/src') },
    dedupe: ['react', 'react-dom', 'zustand'],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
  optimizeDeps: {
    include: ['@react-pdf/renderer'],
  },
  server: {
    port: 5173,
    fs: { allow: [path.resolve(__dirname, '..')] },
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
