import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { '@planner-core': path.resolve(here, '../planner-core/src') }, dedupe: ['zustand'] },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
