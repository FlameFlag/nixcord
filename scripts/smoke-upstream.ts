#!/usr/bin/env bun
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import { CLI_CONFIG } from '@nixcord/shared';
import { parsePlugins } from '@nixcord/parser';

type Args = {
  vencord?: string;
  equicord?: string;
  maxDiagnostics: number;
  minVencordPlugins: number;
  minEquicordPlugins: number;
  keepOutput: boolean;
};

const usage = `Usage: bun run smoke:upstream -- --vencord /path/to/Vencord --equicord /path/to/Equicord [options]

Options:
  --max-diagnostics <n>      Maximum parser diagnostics allowed (default: 25)
  --min-vencord-plugins <n>  Minimum parsed Vencord plugin count (default: 100)
  --min-equicord-plugins <n> Minimum parsed Equicord plugin count (default: 100)
  --keep-output              Keep the temporary generated output directory
`;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    maxDiagnostics: 25,
    minVencordPlugins: 100,
    minEquicordPlugins: 100,
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
      case '--max-diagnostics':
        args.maxDiagnostics = Number.parseInt(next(), 10);
        break;
      case '--min-vencord-plugins':
        args.minVencordPlugins = Number.parseInt(next(), 10);
        break;
      case '--min-equicord-plugins':
        args.minEquicordPlugins = Number.parseInt(next(), 10);
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

  if (!args.vencord || !args.equicord) {
    throw new Error(`Both --vencord and --equicord are required.\n\n${usage}`);
  }
  for (const [name, value] of Object.entries({
    maxDiagnostics: args.maxDiagnostics,
    minVencordPlugins: args.minVencordPlugins,
    minEquicordPlugins: args.minEquicordPlugins,
  })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  }
  return args;
}

function runCommand(command: string, commandArgs: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${commandArgs.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function assertExists(path: string): Promise<void> {
  await stat(path).catch(() => {
    throw new Error(`Expected generated file to exist: ${path}`);
  });
}

const countPlugins = (plugins: Record<string, unknown>): number => Object.keys(plugins).length;
const isValidDeprecatedPluginName = (name: string): boolean => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tmp = await mkdtemp(join(tmpdir(), 'nixcord-upstream-smoke-'));
  const outputPath = join(tmp, 'generated.nix');
  const pluginsDir = join(tmp, CLI_CONFIG.directories.output);

  try {
    await runCommand('node', [
      resolve('packages/cli/dist/index.js'),
      '--vencord',
      args.vencord!,
      '--equicord',
      args.equicord!,
      '--output',
      outputPath,
      '--skip-git-migrations',
      '--verbose',
    ]);

    const generatedFiles = [
      CLI_CONFIG.filenames.shared,
      CLI_CONFIG.filenames.vencord,
      CLI_CONFIG.filenames.equicord,
      CLI_CONFIG.filenames.parseRules,
      CLI_CONFIG.filenames.deprecated,
      CLI_CONFIG.filenames.migrations,
    ].map((file) => join(pluginsDir, file));
    await Promise.all(generatedFiles.map(assertExists));

    const [shared, vencordOnly, equicordOnly] = await Promise.all([
      readJson<Record<string, unknown>>(join(pluginsDir, CLI_CONFIG.filenames.shared)),
      readJson<Record<string, unknown>>(join(pluginsDir, CLI_CONFIG.filenames.vencord)),
      readJson<Record<string, unknown>>(join(pluginsDir, CLI_CONFIG.filenames.equicord)),
    ]);
    const generatedTotal = countPlugins(shared) + countPlugins(vencordOnly) + countPlugins(equicordOnly);
    if (generatedTotal < args.minVencordPlugins) {
      throw new Error(`Generated plugin count too low: ${generatedTotal} < ${args.minVencordPlugins}`);
    }

    const [vencordResult, equicordResult] = await Promise.all([
      parsePlugins(args.vencord!, {
        vencordPluginsDir: CLI_CONFIG.directories.vencordPlugins,
        equicordPluginsDir: CLI_CONFIG.directories.equicordPlugins,
      }),
      parsePlugins(args.equicord!, {
        vencordPluginsDir: CLI_CONFIG.directories.vencordPlugins,
        equicordPluginsDir: CLI_CONFIG.directories.equicordPlugins,
      }),
    ]);

    const vencordCount = countPlugins(vencordResult.vencordPlugins);
    const equicordCount = countPlugins(equicordResult.vencordPlugins) + countPlugins(equicordResult.equicordPlugins);
    if (vencordCount < args.minVencordPlugins) {
      throw new Error(`Parsed Vencord plugin count too low: ${vencordCount} < ${args.minVencordPlugins}`);
    }
    if (equicordCount < args.minEquicordPlugins) {
      throw new Error(`Parsed Equicord plugin count too low: ${equicordCount} < ${args.minEquicordPlugins}`);
    }

    const diagnostics = [...(vencordResult.diagnostics ?? []), ...(equicordResult.diagnostics ?? [])];
    if (diagnostics.length > args.maxDiagnostics) {
      throw new Error(`Parser diagnostics spiked: ${diagnostics.length} > ${args.maxDiagnostics}`);
    }

    const sourceRenames = [...(vencordResult.pluginRenames ?? []), ...(equicordResult.pluginRenames ?? [])].filter(
      (rename) => isValidDeprecatedPluginName(rename.oldName) && isValidDeprecatedPluginName(rename.newName)
    );
    const deprecated = await readJson<{ renames?: Record<string, { to?: string }> }>(
      join(pluginsDir, CLI_CONFIG.filenames.deprecated)
    );
    const missingRenames = sourceRenames.filter((rename) => deprecated.renames?.[rename.oldName]?.to !== rename.newName);
    if (sourceRenames.length > 0 && missingRenames.length > 0) {
      throw new Error(
        `deprecated.json is missing ${missingRenames.length}/${sourceRenames.length} source-level plugin renames from migratePluginSettings()`
      );
    }

    console.log(
      `Upstream smoke passed: generated=${generatedTotal}, vencord=${vencordCount}, equicord=${equicordCount}, diagnostics=${diagnostics.length}, sourceRenames=${sourceRenames.length}`
    );
    if (args.keepOutput) console.log(`Output kept at ${tmp}`);
  } finally {
    if (!args.keepOutput) await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
