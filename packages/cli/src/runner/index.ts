import {
  generateMigrationsJson,
  generateParseRulesModule,
  generatePluginModule,
  toNixIdentifier,
  updateDeprecatedPlugins,
} from '@nixcord/nix-generator';
import type { ParsePluginsOptions } from '@nixcord/parser';
import { categorizePlugins, extractMigrations, parsePlugins } from '@nixcord/parser';
import type { Logger, ParseDiagnostic, Simplify } from '@nixcord/shared';
import {
  CLI_CONFIG,
  Err,
  Ok,
  type ParsedPluginsResult,
  ParsedPluginsResultSchema,
  parseOrThrow,
  type Result,
} from '@nixcord/shared';
import fse from 'fs-extra';
import { dirname, join, normalize, resolve } from 'pathe';
import { z } from 'zod';
import { oraPromise } from './spinner.js';

type SourceLabel = 'Vencord' | 'Equicord';

const LoggerMethodsSchema = z.object({
  info: z.function(),
  warn: z.function(),
  error: z.function(),
  success: z.function(),
  debug: z.function(),
});

const LoggerSchema = z.custom<Logger>(
  (value): value is Logger => LoggerMethodsSchema.safeParse(value).success,
  {
    message: 'Logger must expose info, warn, error, success, and debug methods',
  }
);

const GeneratePluginOptionsParamsSchema = z.object({
  vencordPath: z.string().min(1),
  equicordPath: z.string().min(1).optional(),
  vencordPluginsDir: z.string().min(1),
  equicordPluginsDir: z.string().min(1),
  outputPath: z.string().min(1),
  verbose: z.boolean().optional(),
  logger: LoggerSchema,
  skipGitMigrations: z.boolean().optional(),
});

export type GeneratePluginOptionsParams = Simplify<
  z.infer<typeof GeneratePluginOptionsParamsSchema>
>;

export interface GeneratePluginOptionsSummary {
  pluginsDir: string;
  sharedCount: number;
  vencordOnlyCount: number;
  equicordOnlyCount: number;
  diagnosticSummary?: GeneratePluginOptionsDiagnosticSummary;
}

export interface DiagnosticBucket {
  name: string;
  count: number;
}

export interface GeneratePluginOptionsDiagnosticSummary {
  total: number;
  byKind: DiagnosticBucket[];
  topPlugins: DiagnosticBucket[];
  topFiles: DiagnosticBucket[];
}

class GeneratePluginOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeneratePluginOptionsError';
  }
}

const ensurePathExists = async (path: string, message: string): Promise<void> => {
  const exists = await fse.pathExists(path);
  if (!exists) {
    throw new GeneratePluginOptionsError(message);
  }
};

export const validateParsedResults = (
  vencordResult: ParsedPluginsResult,
  equicordResult?: ParsedPluginsResult
): void => {
  parseOrThrow(ParsedPluginsResultSchema, vencordResult, GeneratePluginOptionsError);
  if (equicordResult) {
    parseOrThrow(ParsedPluginsResultSchema, equicordResult, GeneratePluginOptionsError);
  }
};

const parseSource = async ({
  label,
  path,
  verbose,
  logger,
  parseOptions,
}: {
  label: SourceLabel;
  path: string;
  verbose: boolean;
  logger: Logger;
  parseOptions: ParsePluginsOptions;
}): Promise<ParsedPluginsResult> => {
  if (verbose) {
    logger.info(`Parsing ${label} plugins from: ${path}`);
    return parsePlugins(path, parseOptions);
  }

  return oraPromise(parsePlugins(path, parseOptions), {
    text: `Parsing ${label} plugins...`,
    successText: (result) => {
      const total =
        Object.keys(result.vencordPlugins).length + Object.keys(result.equicordPlugins).length;
      return `Parsed ${total} plugins from ${label}`;
    },
    failText: (error) => `Failed to parse ${label} plugins: ${error.message}`,
  });
};

const getPluginsDir = (outputPath: string): string => {
  return normalize(join(dirname(outputPath), CLI_CONFIG.directories.output));
};

const writeOutputs = async ({
  generic,
  vencordOnly,
  equicordOnly,
  outputPath,
}: {
  generic: ParsedPluginsResult['vencordPlugins'];
  vencordOnly: ParsedPluginsResult['vencordPlugins'];
  equicordOnly: ParsedPluginsResult['vencordPlugins'];
  outputPath: string;
}): Promise<GeneratePluginOptionsSummary> => {
  const pluginsDir = getPluginsDir(outputPath);
  await fse.ensureDir(pluginsDir);

  const sharedPath = resolve(pluginsDir, CLI_CONFIG.filenames.shared);
  await fse.writeFile(sharedPath, generatePluginModule(generic, 'shared'));

  const vencordFilePath = resolve(pluginsDir, CLI_CONFIG.filenames.vencord);
  await fse.writeFile(vencordFilePath, generatePluginModule(vencordOnly, 'vencord'));

  const equicordFilePath = resolve(pluginsDir, CLI_CONFIG.filenames.equicord);
  await fse.writeFile(equicordFilePath, generatePluginModule(equicordOnly, 'equicord'));

  const parseRulesFilePath = resolve(pluginsDir, CLI_CONFIG.filenames.parseRules);
  await fse.writeFile(
    parseRulesFilePath,
    generateParseRulesModule(generic, vencordOnly, equicordOnly)
  );

  return {
    pluginsDir,
    sharedCount: Object.keys(generic).length,
    vencordOnlyCount: Object.keys(vencordOnly).length,
    equicordOnlyCount: Object.keys(equicordOnly).length,
  };
};

const summarizeCounts = (values: readonly string[], limit: number): DiagnosticBucket[] =>
  Array.from(
    values.reduce(
      (counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1),
      new Map<string, number>()
    ),
    ([name, count]) => ({ name, count })
  )
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, limit);

const summarizeDiagnostics = (
  diagnostics: readonly ParseDiagnostic[]
): GeneratePluginOptionsDiagnosticSummary | undefined => {
  if (diagnostics.length === 0) return undefined;

  return {
    total: diagnostics.length,
    byKind: summarizeCounts(
      diagnostics.map((diagnostic) => diagnostic.kind),
      Number.POSITIVE_INFINITY
    ),
    topPlugins: summarizeCounts(
      diagnostics.flatMap((diagnostic) =>
        diagnostic.pluginName === undefined ? [] : [diagnostic.pluginName]
      ),
      10
    ),
    topFiles: summarizeCounts(
      diagnostics.flatMap((diagnostic) =>
        diagnostic.filePath === undefined ? [] : [diagnostic.filePath]
      ),
      10
    ),
  };
};

export const runGeneratePluginOptions = async (
  rawParams: GeneratePluginOptionsParams
): Promise<Result<GeneratePluginOptionsSummary, Error>> => {
  const parsedParams = GeneratePluginOptionsParamsSchema.parse(rawParams);
  const verbose = parsedParams.verbose ?? false;
  try {
    const resolvedVencordPath = resolve(process.cwd(), parsedParams.vencordPath);
    const vencordPackageJsonPath = resolve(resolvedVencordPath, CLI_CONFIG.filenames.packageJson);
    await ensurePathExists(
      vencordPackageJsonPath,
      `Vencord source path does not exist or is not a directory: ${resolvedVencordPath}`
    );

    const vencordPluginsPath = resolve(resolvedVencordPath, parsedParams.vencordPluginsDir);
    await ensurePathExists(
      vencordPluginsPath,
      `Vencord plugins directory not found: ${vencordPluginsPath}`
    );

    const resolvedEquicordPath = await (async () => {
      if (typeof parsedParams.equicordPath !== 'string') return undefined;
      const resolved = resolve(process.cwd(), parsedParams.equicordPath);
      const equicordPackageJsonPath = resolve(resolved, CLI_CONFIG.filenames.packageJson);
      await ensurePathExists(
        equicordPackageJsonPath,
        `Equicord source path does not exist or is not a directory: ${resolved}`
      );

      const equicordPluginsPath = resolve(resolved, parsedParams.equicordPluginsDir);
      await ensurePathExists(
        equicordPluginsPath,
        `Equicord plugins directory not found: ${equicordPluginsPath}`
      );
      return resolved;
    })();

    const parseOptions: ParsePluginsOptions = {
      vencordPluginsDir: parsedParams.vencordPluginsDir,
      equicordPluginsDir: parsedParams.equicordPluginsDir,
    };

    const vencordResult = await parseSource({
      label: 'Vencord',
      path: resolvedVencordPath,
      verbose,
      logger: parsedParams.logger,
      parseOptions,
    });

    const equicordResult = resolvedEquicordPath
      ? await parseSource({
          label: 'Equicord',
          path: resolvedEquicordPath,
          verbose,
          logger: parsedParams.logger,
          parseOptions,
        })
      : undefined;

    validateParsedResults(vencordResult, equicordResult);

    const diagnostics = [
      ...(vencordResult.diagnostics ?? []),
      ...(equicordResult?.diagnostics ?? []),
    ];
    const diagnosticSummary = summarizeDiagnostics(diagnostics);
    if (verbose && diagnostics.length > 0) {
      parsedParams.logger.warn(`Parser reported ${diagnostics.length} diagnostics`);
      for (const diagnostic of diagnostics.slice(0, 20)) {
        parsedParams.logger.warn(
          `${diagnostic.kind}${diagnostic.pluginName ? ` (${diagnostic.pluginName})` : ''}: ${diagnostic.message}`
        );
      }
    }

    const categorized = categorizePlugins(vencordResult, equicordResult);

    if (verbose) {
      parsedParams.logger.info(
        `Found ${Object.keys(vencordResult.vencordPlugins).length} plugins in Vencord src/plugins`
      );
      if (equicordResult) {
        parsedParams.logger.info(
          `Found ${Object.keys(equicordResult.vencordPlugins).length} plugins in Equicord src/plugins`
        );
        parsedParams.logger.info(
          `Found ${Object.keys(equicordResult.equicordPlugins).length} plugins in Equicord src/equicordplugins`
        );
      }
      parsedParams.logger.info(
        `Categorized: ${Object.keys(categorized.generic).length} generic (shared), ${Object.keys(categorized.vencordOnly).length} Vencord-only, ${
          Object.keys(categorized.equicordOnly).length
        } Equicord-only`
      );
    }

    const outputSummary = await writeOutputs({
      generic: categorized.generic,
      vencordOnly: categorized.vencordOnly,
      equicordOnly: categorized.equicordOnly,
      outputPath: parsedParams.outputPath,
    });
    const summary = diagnosticSummary ? { ...outputSummary, diagnosticSummary } : outputSummary;

    // Extract migrations and update deprecated.json + migrations.json
    try {
      const pluginsDir = getPluginsDir(parsedParams.outputPath);

      // Run migration extraction on both repos when git history is available.
      // Nix package builds intentionally pass --skip-git-migrations so source
      // fetches do not need leaveDotGit=true. CI can run this against ordinary
      // git clones and commit the resulting deprecated.json/migrations.json.
      const vencordMigrations = parsedParams.skipGitMigrations
        ? { renames: [], deletions: [] }
        : await extractMigrations(resolvedVencordPath, [parsedParams.vencordPluginsDir]);
      const equicordMigrations = parsedParams.skipGitMigrations
        ? { renames: [], deletions: [] }
        : resolvedEquicordPath
          ? await extractMigrations(resolvedEquicordPath, [
              parsedParams.vencordPluginsDir,
              parsedParams.equicordPluginsDir,
            ])
          : { renames: [], deletions: [] };

      const sourcePluginRenames = [
        ...(vencordResult.pluginRenames ?? []),
        ...(equicordResult?.pluginRenames ?? []),
      ].map((rename) => ({
        ...rename,
        commitDate: new Date().toISOString(),
        commitHash: 'source-migration',
      }));

      // Combine migrations from both repos and explicit migratePluginSettings() calls.
      const combinedMigrations = {
        renames: [
          ...vencordMigrations.renames,
          ...equicordMigrations.renames,
          ...sourcePluginRenames,
        ],
        deletions: [...vencordMigrations.deletions, ...equicordMigrations.deletions],
      };

      // Collect setting renames from both parsed results
      const allSettingRenames = [
        ...(vencordResult.settingRenames ?? []),
        ...(equicordResult?.settingRenames ?? []),
      ];

      // Combine all parsed plugins for the migrations generator
      const allPlugins = {
        ...categorized.generic,
        ...categorized.vencordOnly,
        ...categorized.equicordOnly,
      };

      // Build set of active plugin names to filter false-positive removals
      const activePluginNames = new Set(Object.keys(allPlugins));

      const deprecated = await updateDeprecatedPlugins(
        combinedMigrations,
        pluginsDir,
        verbose,
        parsedParams.logger,
        allSettingRenames,
        activePluginNames,
        toNixIdentifier
      );
      const migrationsJson = generateMigrationsJson(deprecated, allPlugins, [
        categorized.generic,
        categorized.vencordOnly,
        categorized.equicordOnly,
      ]);
      const migrationsPath = resolve(pluginsDir, CLI_CONFIG.filenames.migrations);
      await fse.writeFile(migrationsPath, migrationsJson);
    } catch (error) {
      // Migration extraction is best-effort; don't fail the build if it fails
      if (verbose) {
        parsedParams.logger.warn(`Failed to extract migrations: ${error}`);
      }
    }

    return Ok(summary);
  } catch (error) {
    const normalized =
      error instanceof Error ? error : new GeneratePluginOptionsError(String(error));
    return Err(normalized);
  }
};
