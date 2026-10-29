import { defineConfig } from 'vitest/config';

// jsdom: the sanitiser (DOMPurify) and the components need a DOM. The pure helpers run fine in it too.
export default defineConfig({
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] },
});
