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
        '@nixcord/ast',
        '@nixcord/shared',
        'change-case',
        'type-fest',
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
