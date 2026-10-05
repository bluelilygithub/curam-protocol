import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@planner-core': path.resolve(here, '../planner-core/src'),
      // Vault's existing spoken-number parser ("two point five" -> 2.5), reused for number fields
      '@vault-client': path.resolve(here, '../client/src'),
    },
    dedupe: ['three', 'react', 'react-dom', 'zustand', 'konva'],
  },
  test: { include: ['tests/**/*.test.ts'] },
});
