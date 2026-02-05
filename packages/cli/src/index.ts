#!/usr/bin/env node

import { runCli, handleCliError } from './cli.js';
export { runGeneratePluginOptions, validateParsedResults } from './runner/index.js';

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  await runCli().catch(handleCliError);
}
