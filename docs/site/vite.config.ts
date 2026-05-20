import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';

function resolveRevision() {
  if (process.env.NIXCORD_REVISION) return process.env.NIXCORD_REVISION;

  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/nixcord/' : '/',
  define: {
    __NIXCORD_REVISION__: JSON.stringify(resolveRevision()),
  },
  plugins: [svelte(), tailwindcss()],
}));
