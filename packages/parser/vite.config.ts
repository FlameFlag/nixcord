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
      external: [
        /^node:/,
        'child_process',
        'util',
        '@nixcord/ast',
        '@nixcord/git-analyzer',
        '@nixcord/shared',
        'fast-glob',
        'fs-extra',
        'p-limit',
        'pathe',
        'ts-morph',
        'type-fest',
        'zod',
      ],
    },
  },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    pool: 'threads',
  },
});
