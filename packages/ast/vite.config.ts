import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rolldownOptions: {
      external: [/^node:/, '@nixcord/shared', 'ts-morph'],
    },
  },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    pool: 'threads',
    isolate: false,
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
