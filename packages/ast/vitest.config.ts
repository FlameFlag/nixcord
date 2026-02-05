import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    maxWorkers: 4,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'src/navigator/index.ts',
        'src/extractor/select/default/index.ts',
        'src/extractor/select/index.ts',
        'src/extractor/select/options/index.ts',
        'src/extractor/select/patterns/index.ts',
        'src/extractor/type-inference/index.ts',
        'src/extractor/constants.ts',
        'src/extractor/types.ts',
        'src/extractor/type-helpers.ts',
        'src/extractor/type-inference/types.ts',
        '**/*.test.ts',
        '**/dist/**',
      ],
    },
  },
});
