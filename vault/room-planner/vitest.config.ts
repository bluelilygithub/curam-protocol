import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@planner-core': path.resolve(here, '../planner-core/src') },
    dedupe: ['three', 'react', 'react-dom', 'zustand', 'konva'],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/engine/**', '../planner-core/src/engine/**'], thresholds: { lines: 95 } },
  },
});
