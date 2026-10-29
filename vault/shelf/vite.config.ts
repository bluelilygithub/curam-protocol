import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * The tray is a local page loaded by the native shell (never from the network). In the BUILT page a strict Content-Security-Policy is added:
 * no network from the page itself (the native side talks to Vault, so the key never reaches the webview), no inline script, and pictures only
 * from data: / blob: (previews are made from sanitised copies). The dev server skips it because Vite's hot reload needs inline script.
 */
function strictCsp(): Plugin {
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // Tailwind classes are in the stylesheet; React sets a few inline sizes (list windowing)
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' ipc: http://ipc.localhost", // Tauri's IPC; harmless elsewhere
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'shelf-strict-csp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' }],
  };
}

export default defineConfig({
  base: './', // the shell loads the built page from disk
  plugins: [react(), strictCsp()],
  server: { port: 5177, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, target: 'es2022' },
});
