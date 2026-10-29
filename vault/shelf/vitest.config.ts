import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

// jsdom: the sanitiser (DOMPurify) and the components need a DOM. The pure helpers run fine in it too.
export default defineConfig({
  resolve: { alias: { '@vault-client': path.resolve(here, '../client/src') } },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] },
});
