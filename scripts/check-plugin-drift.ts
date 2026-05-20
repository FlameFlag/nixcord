#!/usr/bin/env bun
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { CLI_CONFIG, createLogger, type Logger } from '@nixcord/shared';
import { runGeneratePluginOptions } from '../packages/cli/src/runner/index.js';
import { logGeneratePluginOptionsSummary } from '../packages/cli/src/summary.js';

type DriftCheckOptions = {
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
  --no-build             Use the already-built workspace packages
  --keep-output          Keep the temporary generated output directory
  --help, -h             Show this help
`;

const generatedFiles = [
  CLI_CONFIG.filenames.shared,
  CLI_CONFIG.filenames.vencord,
  CLI_CONFIG.filenames.equicord,
  CLI_CONFIG.filenames.parseRules,
  CLI_CONFIG.filenames.deprecated,
  CLI_CONFIG.filenames.migrations,
] as const;

const overridableFiles = {
  shared: CLI_CONFIG.filenames.shared,
  vencord: CLI_CONFIG.filenames.vencord,
  equicord: CLI_CONFIG.filenames.equicord,
} as const;

type JsonObject = Record<string, unknown>;
type PluginOverrides = Partial<Record<keyof typeof overridableFiles, JsonObject>>;

function parseDriftOptions(argv: string[]): DriftCheckOptions | 'help' {
  const { values } = parseArgs({
    args: argv,
    options: {
      vencord: { type: 'string', default: CLI_CONFIG.sources.vencord },
      equicord: { type: 'string', default: CLI_CONFIG.sources.equicord },
      'expected-dir': { type: 'string', default: 'modules/plugins' },
      'no-build': { type: 'boolean', default: false },
      'keep-output': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) return 'help';

  return {
    vencord: values.vencord,
    equicord: values.equicord,
    expectedDir: values['expected-dir'],
    build: !values['no-build'],
    keepOutput: values['keep-output'],
  };
}

async function diffFiles(expectedPath: string, generatedPath: string): Promise<boolean> {
  const result = await Bun.$`diff -u ${expectedPath} ${generatedPath}`.nothrow();

  if (result.exitCode === 0) return false;
  if (result.exitCode === 1) return true;
  throw new Error(`diff exited with code ${result.exitCode}`);
}

async function assertExists(path: string): Promise<void> {
  await stat(path).catch(() => {
    throw new Error(`Expected file to exist: ${path}`);
  });
}

function isPlainObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeJson(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;

  const result: JsonObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = key in result ? mergeJson(result[key], value) : value;
  }
  return result;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function applyOverrides(expectedDir: string, generatedDir: string): Promise<void> {
  const overridesPath = join(expectedDir, 'overrides.json');
  if (
    !(await stat(overridesPath).then(
      () => true,
      () => false
    ))
  )
    return;

  const overrides = await readJson<PluginOverrides>(overridesPath);
  for (const [category, filename] of Object.entries(overridableFiles)) {
    const override = overrides[category as keyof typeof overridableFiles];
    if (!override) continue;

    const generatedPath = join(generatedDir, filename);
    const generated = await readJson<unknown>(generatedPath);
    await writeFile(generatedPath, JSON.stringify(mergeJson(generated, override), null, 2));
  }
}

async function runDriftCheck(options: DriftCheckOptions, logger: Logger): Promise<void> {
  const expectedDir = resolve(options.expectedDir);
  const tmp = await mkdtemp(join(tmpdir(), 'nixcord-plugin-drift-'));
  const generatedOutput = join(tmp, 'generated.nix');
  const generatedDir = join(tmp, CLI_CONFIG.directories.output);

  try {
    if (options.build) await Bun.$`bun run build`;

    await assertExists(join(expectedDir, CLI_CONFIG.filenames.deprecated));
    await mkdir(generatedDir, { recursive: true });
    await copyFile(
      join(expectedDir, CLI_CONFIG.filenames.deprecated),
      join(generatedDir, CLI_CONFIG.filenames.deprecated)
    );

    const result = await runGeneratePluginOptions({
      vencordPath: options.vencord,
      equicordPath: options.equicord,
      outputPath: generatedOutput,
      verbose: true,
      logger,
      vencordPluginsDir: CLI_CONFIG.directories.vencordPlugins,
      equicordPluginsDir: CLI_CONFIG.directories.equicordPlugins,
      skipGitMigrations: true,
    });

    if (!result.ok) throw result.error;
    logGeneratePluginOptionsSummary(logger, result.value);
    await applyOverrides(expectedDir, generatedDir);

    let hasDrift = false;
    for (const file of generatedFiles) {
      const expectedPath = join(expectedDir, file);
      const generatedPath = join(generatedDir, file);
      await assertExists(expectedPath);
      await assertExists(generatedPath);
      hasDrift ||= await diffFiles(expectedPath, generatedPath);
    }

    if (hasDrift) {
      logger.error(`Plugin output drift detected. Generated output is at ${generatedDir}`);
      process.exitCode = 1;
    } else {
      logger.success('Plugin output is in sync with upstream sources.');
    }

    if (options.keepOutput) logger.info(`Output kept at ${tmp}`);
  } finally {
    if (!options.keepOutput) await rm(tmp, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const options = parseDriftOptions(process.argv.slice(2));
  if (options === 'help') {
    process.stdout.write(usage);
    return;
  }

  await runDriftCheck(options, createLogger(true));
}

main().catch((error) => {
  const logger = createLogger(true);
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
