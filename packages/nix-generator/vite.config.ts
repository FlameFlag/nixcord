import { createViteConfig } from '../../vite.config.shared.js';

export default createViteConfig({
  mode: 'lib',
  external: [/^node:/, '@nixcord/ast', '@nixcord/shared', '@nixcord/git-analyzer', 'change-case', 'fs-extra', 'pathe'],
  testTimeout: 20000,
  testPool: 'threads',
});
