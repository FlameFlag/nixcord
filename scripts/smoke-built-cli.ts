#!/usr/bin/env bun
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
}

await run('node', [resolve('packages/cli/dist/index.js'), '--help']);
