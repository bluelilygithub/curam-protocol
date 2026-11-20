import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

// pdf.js's modern build expects browser globals; the legacy build is the one meant for Node.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' },
      { find: '@vault-client', replacement: path.resolve(here, '../client/src') },
    ],
  },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000 },
});
