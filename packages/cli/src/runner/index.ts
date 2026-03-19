import { dirname, join, normalize, resolve } from 'pathe';
import fse from 'fs-extra';

import { z } from 'zod';
import { fromZodError } from 'zod-validation-error';
import { type Result, Ok, Err } from '@nixcord/shared';
import { oraPromise } from 'ora';
import type { Simplify } from 'type-fest';

import { CLI_CONFIG } from '@nixcord/shared';
import {
  parsePlugins,
  categorizePlugins,
  extractMigrations,
  updateDeprecatedPlugins,
} from '@nixcord/parser';
import type { ParsePluginsOptions } from '@nixcord/parser';
import {
  generateNixModule,
  generateParseRulesModule,
  generateMigrationsModule,
  NixGenerator,
} from '@nixcord/nix-generator';
import { ParsedPluginsResultSchema, type ParsedPluginsResult } from '@nixcord/shared';
import type { Logger } from '@nixcord/shared';

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
});

export type GeneratePluginOptionsParams = Simplify<
  z.infer<typeof GeneratePluginOptionsParamsSchema>
>;

export interface GeneratePluginOptionsSummary {
  pluginsDir: string;
  sharedCount: number;
  vencordOnlyCount: number;
  equicordOnlyCount: number;
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
  const vencordValidation = ParsedPluginsResultSchema.safeParse(vencordResult);
  if (!vencordValidation.success) {
    const zodError = fromZodError(vencordValidation.error);
    throw new GeneratePluginOptionsError(zodError.message);
  }

  if (equicordResult) {
    const equicordValidation = ParsedPluginsResultSchema.safeParse(equicordResult);
    if (!equicordValidation.success) {
      const zodError = fromZodError(equicordValidation.error);
      throw new GeneratePluginOptionsError(zodError.message);
    }
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
  const outputDir = dirname(outputPath);
  return normalize(join(outputDir, CLI_CONFIG.directories.output));
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
  await fse.writeFile(sharedPath, generateNixModule(generic, 'shared'));

  const vencordFilePath = resolve(pluginsDir, CLI_CONFIG.filenames.vencord);
  await fse.writeFile(vencordFilePath, generateNixModule(vencordOnly, 'vencord'));

  const equicordFilePath = resolve(pluginsDir, CLI_CONFIG.filenames.equicord);
  await fse.writeFile(equicordFilePath, generateNixModule(equicordOnly, 'equicord'));

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

export const runGeneratePluginOptions = async (
  rawParams: GeneratePluginOptionsParams
): Promise<Result<GeneratePluginOptionsSummary, Error>> => {
  const {
    vencordPath,
    equicordPath,
    vencordPluginsDir,
    equicordPluginsDir,
    outputPath,
    verbose = false,
    logger,
  } = GeneratePluginOptionsParamsSchema.parse(rawParams);
  try {
    const resolvedVencordPath = resolve(process.cwd(), vencordPath);
    const vencordPackageJsonPath = resolve(resolvedVencordPath, CLI_CONFIG.filenames.packageJson);
    await ensurePathExists(
      vencordPackageJsonPath,
      `Vencord source path does not exist or is not a directory: ${resolvedVencordPath}`
    );

    const vencordPluginsPath = resolve(resolvedVencordPath, vencordPluginsDir);
    await ensurePathExists(
      vencordPluginsPath,
      `Vencord plugins directory not found: ${vencordPluginsPath}`
    );

    const resolvedEquicordPath = await (async () => {
      if (typeof equicordPath !== 'string') return undefined;
      const resolved = resolve(process.cwd(), equicordPath);
      const equicordPackageJsonPath = resolve(resolved, CLI_CONFIG.filenames.packageJson);
      await ensurePathExists(
        equicordPackageJsonPath,
        `Equicord source path does not exist or is not a directory: ${resolved}`
      );

      const equicordPluginsPath = resolve(resolved, equicordPluginsDir);
      await ensurePathExists(
        equicordPluginsPath,
        `Equicord plugins directory not found: ${equicordPluginsPath}`
      );
      return resolved;
    })();

    const parseOptions: ParsePluginsOptions = {
      vencordPluginsDir,
      equicordPluginsDir,
    };

    const vencordResult = await parseSource({
      label: 'Vencord',
      path: resolvedVencordPath,
      verbose,
      logger,
      parseOptions,
    });

    const equicordResult = resolvedEquicordPath
      ? await parseSource({
          label: 'Equicord',
          path: resolvedEquicordPath,
          verbose,
          logger,
          parseOptions,
        })
      : undefined;

    validateParsedResults(vencordResult, equicordResult);

    const { generic, vencordOnly, equicordOnly } = categorizePlugins(vencordResult, equicordResult);

    if (verbose) {
      logger.info(
        `Found ${Object.keys(vencordResult.vencordPlugins).length} plugins in Vencord src/plugins`
      );
      if (equicordResult) {
        logger.info(
          `Found ${Object.keys(equicordResult.vencordPlugins).length} plugins in Equicord src/plugins`
        );
        logger.info(
          `Found ${Object.keys(equicordResult.equicordPlugins).length} plugins in Equicord src/equicordplugins`
        );
      }
      logger.info(
        `Categorized: ${Object.keys(generic).length} generic (shared), ${Object.keys(vencordOnly).length} Vencord-only, ${
          Object.keys(equicordOnly).length
        } Equicord-only`
      );
    }

    const summary = await writeOutputs({
      generic,
      vencordOnly,
      equicordOnly,
      outputPath,
    });

    // Extract migrations and update deprecated.nix + migrations.nix
    try {
      const pluginsDir = getPluginsDir(outputPath);

      // Run migration extraction on both repos
      const vencordMigrations = await extractMigrations(resolvedVencordPath, [vencordPluginsDir]);
      const equicordMigrations = resolvedEquicordPath
        ? await extractMigrations(resolvedEquicordPath, [vencordPluginsDir, equicordPluginsDir])
        : { renames: [], deletions: [] };

      // Combine migrations from both repos
      const combinedMigrations = {
        renames: [...vencordMigrations.renames, ...equicordMigrations.renames],
        deletions: [...vencordMigrations.deletions, ...equicordMigrations.deletions],
      };

      // Collect setting renames from both parsed results
      const allSettingRenames = [
        ...(vencordResult.settingRenames ?? []),
        ...(equicordResult?.settingRenames ?? []),
      ];

      // Combine all parsed plugins for the migrations generator
      const allPlugins = { ...generic, ...vencordOnly, ...equicordOnly };

      // Build set of active plugin names to filter false-positive removals
      const activePluginNames = new Set(Object.keys(allPlugins));
      const gen = new NixGenerator();

      const deprecated = await updateDeprecatedPlugins(
        combinedMigrations,
        pluginsDir,
        verbose,
        logger,
        allSettingRenames,
        activePluginNames,
        (name) => gen.identifier(name)
      );
      const migrationsNix = generateMigrationsModule(deprecated, allPlugins, [
        generic,
        vencordOnly,
        equicordOnly,
      ]);
      const migrationsPath = resolve(pluginsDir, CLI_CONFIG.filenames.migrations);
      await fse.writeFile(migrationsPath, migrationsNix);
    } catch (error) {
      // Migration extraction is best-effort; don't fail the build if it fails
      if (verbose) {
        logger.warn(`Failed to extract migrations: ${error}`);
      }
    }

    return Ok(summary);
  } catch (error) {
    const normalized =
      error instanceof Error ? error : new GeneratePluginOptionsError(String(error));
    return Err(normalized);
  }
};
