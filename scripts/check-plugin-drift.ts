#!/usr/bin/env bun
import { copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import { CLI_CONFIG } from '@nixcord/shared';

type Args = {
  vencord: string;
  equicord: string;
  expectedDir: string;
  build: boolean;
  keepOutput: boolean;
};

const usage = `Usage: bun scripts/check-plugin-drift.ts [options]

Regenerates plugin JSON from the configured Vencord/Equicord sources and diffs it
against modules/plugins. Exits non-zero when generated output has drifted.

Options:
  --vencord <path>       Vencord source path (default: ${CLI_CONFIG.sources.vencord})
  --equicord <path>      Equicord source path (default: ${CLI_CONFIG.sources.equicord})
  --expected-dir <path>  Directory with committed plugin JSON (default: modules/plugins)
  --no-build             Use existing packages/cli/dist instead of building first
  --keep-output          Keep the temporary generated output directory
`;

const generatedFiles = [
  CLI_CONFIG.filenames.shared,
  CLI_CONFIG.filenames.vencord,
  CLI_CONFIG.filenames.equicord,
  CLI_CONFIG.filenames.parseRules,
  CLI_CONFIG.filenames.deprecated,
  CLI_CONFIG.filenames.migrations,
] as const;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    vencord: CLI_CONFIG.sources.vencord,
    equicord: CLI_CONFIG.sources.equicord,
    expectedDir: 'modules/plugins',
    build: true,
    keepOutput: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}\n\n${usage}`);
      return value;
    };

    switch (arg) {
      case '--vencord':
        args.vencord = next();
        break;
      case '--equicord':
        args.equicord = next();
        break;
      case '--expected-dir':
        args.expectedDir = next();
        break;
      case '--no-build':
        args.build = false;
        break;
      case '--keep-output':
        args.keepOutput = true;
        break;
      case '--help':
      case '-h':
        console.log(usage);
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}\n\n${usage}`);
    }
  }

  return args;
}

function runCommand(command: string, commandArgs: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new Error(`${command} ${commandArgs.join(' ')} exited with code ${code ?? 'unknown'}`)
        );
    });
  });
}

function diffFiles(expectedPath: string, generatedPath: string): Promise<boolean> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('diff', ['-u', expectedPath, generatedPath], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise(false);
      else if (code === 1) resolvePromise(true);
      else reject(new Error(`diff exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function assertExists(path: string): Promise<void> {
  await stat(path).catch(() => {
    throw new Error(`Expected file to exist: ${path}`);
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const expectedDir = resolve(args.expectedDir);
  const tmp = await mkdtemp(join(tmpdir(), 'nixcord-plugin-drift-'));
  const generatedOutput = join(tmp, 'generated.nix');
  const generatedDir = join(tmp, CLI_CONFIG.directories.output);

  try {
    if (args.build) await runCommand('bun', ['run', 'build']);

    await assertExists(join(expectedDir, CLI_CONFIG.filenames.deprecated));
    await mkdir(generatedDir, { recursive: true });
    await copyFile(
      join(expectedDir, CLI_CONFIG.filenames.deprecated),
      join(generatedDir, CLI_CONFIG.filenames.deprecated)
    );

    await runCommand('node', [
      resolve('packages/cli/dist/index.js'),
      '--vencord',
      args.vencord,
      '--equicord',
      args.equicord,
      '--output',
      generatedOutput,
      '--skip-git-migrations',
      '--verbose',
    ]);

    let hasDrift = false;
    for (const file of generatedFiles) {
      const expectedPath = join(expectedDir, file);
      const generatedPath = join(generatedDir, file);
      await assertExists(expectedPath);
      await assertExists(generatedPath);
      const changed = await diffFiles(expectedPath, generatedPath);
      hasDrift ||= changed;
    }

    if (hasDrift) {
      console.error(`Plugin output drift detected. Generated output is at ${generatedDir}`);
      process.exitCode = 1;
    } else {
      console.log('Plugin output is in sync with upstream sources.');
    }

    if (args.keepOutput) console.log(`Output kept at ${tmp}`);
  } finally {
    if (!args.keepOutput) await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
