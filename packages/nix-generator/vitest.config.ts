import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    maxWorkers: 4,
    pool: 'forks',
  },
});
