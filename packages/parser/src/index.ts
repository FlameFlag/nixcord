import { Project, ts, SyntaxKind } from 'ts-morph';
import pLimit from 'p-limit';
import { basename, dirname, normalize, join } from 'pathe';
import fse from 'fs-extra';
import fg from 'fast-glob';
import { match, P } from 'ts-pattern';
import { z } from 'zod';
import type { ReadonlyDeep, SetOptional } from 'type-fest';
import type { PluginConfig, ParsedPluginsResult, Logger } from '@nixcord/shared';
import { extractPluginInfo } from '@nixcord/ast';
import { findDefinePluginSettings, findDefinePluginCall } from '@nixcord/ast';
import { extractSettingsFromCall, extractSettingsFromObject } from '@nixcord/ast';
import { CLI_CONFIG, AUTO_GENERATED_HEADER, filterNullish } from '@nixcord/shared';

const PLUGIN_SOURCE_FILE_PATTERNS = ['index.tsx', 'index.ts', 'settings.ts'] as const;
const TSCONFIG_FILE_NAME = 'tsconfig.json';
const PARALLEL_PROCESSING_LIMIT = 5;
const PROGRESS_REPORT_INTERVAL = 10;
const PLUGIN_DIR_SEPARATOR_PATTERN = /[-_]/;
const PLUGIN_FILE_GLOB_PATTERN = '*/index.{ts,tsx}';
const CURRENT_DIRECTORY = '.';
const ParsePluginsOptionsSchema = z.object({
  vencordPluginsDir: z.string().min(1).optional(),
  equicordPluginsDir: z.string().min(1).optional(),
});

async function createProject(sourcePath: string): Promise<Project> {
  const tsConfigPath = normalize(join(sourcePath, TSCONFIG_FILE_NAME));
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
      allowJs: true,
      skipLibCheck: true,
    },
    tsConfigFilePath: (await fse.pathExists(tsConfigPath)) ? tsConfigPath : undefined,
  });

  const typesPath = normalize(join(sourcePath, 'src/utils/types.ts'));
  if (await fse.pathExists(typesPath)) project.addSourceFileAtPath(typesPath);

  const discordEnumsDir = normalize(join(sourcePath, 'packages/discord-types/enums'));
  if (await fse.pathExists(discordEnumsDir)) {
    for (const file of await fg('**/*.ts', {
      cwd: discordEnumsDir,
      absolute: false,
      onlyFiles: true,
    })) {
      project.addSourceFileAtPath(normalize(join(discordEnumsDir, file)));
    }
  }

  const shikiThemesPath = normalize(
    join(sourcePath, 'src/plugins/shikiCodeblocks.desktop/api/themes.ts')
  );
  if (await fse.pathExists(shikiThemesPath)) project.addSourceFileAtPath(shikiThemesPath);

  return project;
}

async function findPluginSourceFile(pluginPath: string): Promise<string | undefined> {
  for (const pattern of PLUGIN_SOURCE_FILE_PATTERNS) {
    const filePath = normalize(join(pluginPath, pattern));
    if (await fse.pathExists(filePath)) return filePath;
  }
  return undefined;
}

async function parseSinglePlugin(
  pluginDir: string,
  pluginPath: string,
  project: Project,
  typeChecker: ReturnType<Project['getTypeChecker']>
): Promise<[string, PluginConfig] | undefined> {
  const path = await findPluginSourceFile(pluginPath);
  if (!path) return undefined;

  const sourceFile = project.addSourceFileAtPath(path);
  if (!sourceFile) return undefined;
  const pluginInfo = extractPluginInfo(sourceFile, typeChecker);

  // Derive plugin name from directory if not explicitly defined
  const pluginName =
    pluginInfo.name ||
    pluginDir
      .split(PLUGIN_DIR_SEPARATOR_PATTERN)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join('');

  // If we still don't have a plugin name, skip this plugin
  if (!pluginName) return undefined;

  let settingsCall = findDefinePluginSettings(sourceFile);
  if (settingsCall === undefined) {
    // Try settings.tsx first, then settings.ts
    const settingsPathTsx = normalize(join(pluginPath, 'settings.tsx'));
    const settingsPathTs = normalize(join(pluginPath, 'settings.ts'));

    const settingsPath = (await fse.pathExists(settingsPathTsx))
      ? settingsPathTsx
      : (await fse.pathExists(settingsPathTs))
        ? settingsPathTs
        : null;

    if (settingsPath) {
      settingsCall = findDefinePluginSettings(project.addSourceFileAtPath(settingsPath));
    }
  }

  let settings: Record<string, unknown> =
    settingsCall !== undefined
      ? extractSettingsFromCall(settingsCall, typeChecker, project.getProgram(), true)
      : {};

  // Bug 1 fix: If no definePluginSettings() was found, fall back to extracting
  // inline `options: {}` from the definePlugin() call.
  if (settingsCall === undefined && Object.keys(settings).length === 0) {
    const definePluginCallExpr = findDefinePluginCall(sourceFile);
    if (definePluginCallExpr) {
      const args = definePluginCallExpr.getArguments();
      if (args.length > 0) {
        const pluginObj = args[0].asKind(SyntaxKind.ObjectLiteralExpression);
        if (pluginObj) {
          const optionsProp = pluginObj.getProperty('options')?.asKind(SyntaxKind.PropertyAssignment);
          const optionsInit = optionsProp?.getInitializer()?.asKind(SyntaxKind.ObjectLiteralExpression);
          if (optionsInit) {
            settings = extractSettingsFromObject(optionsInit, typeChecker, project.getProgram(), true);
          }
        }
      }
    }
  }

  const pluginConfig: PluginConfig = {
    name: pluginName,
    settings,
    directoryName: pluginDir,
    ...(pluginInfo.description ? { description: pluginInfo.description } : {}),
    ...(pluginInfo.isModified !== undefined ? { isModified: pluginInfo.isModified } : {}),
  };

  return [pluginName, pluginConfig];
}

async function parsePluginsFromDirectory(
  pluginsPath: string,
  project: Project,
  typeChecker: ReturnType<Project['getTypeChecker']>,
  isTTY: boolean
): Promise<ReadonlyDeep<Record<string, PluginConfig>>> {
  const pluginDirsArray = [
    ...new Set(
      (
        await fg(PLUGIN_FILE_GLOB_PATTERN, { cwd: pluginsPath, absolute: false, onlyFiles: true })
      ).map(dirname)
    ),
  ].filter((dir) => dir !== CURRENT_DIRECTORY);

  if (!isTTY)
    console.log(`Found ${pluginDirsArray.length} plugin directories in ${basename(pluginsPath)}`);

  const limit = pLimit(PARALLEL_PROCESSING_LIMIT);
  let processed = 0;

  const results = await Promise.all(
    pluginDirsArray.map(async (pluginDir) => {
      const result = await limit(() =>
        parseSinglePlugin(pluginDir, normalize(join(pluginsPath, pluginDir)), project, typeChecker)
      );
      processed++;
      if (!isTTY && processed % PROGRESS_REPORT_INTERVAL === 0) {
        console.log(`Processed ${processed}/${pluginDirsArray.length} plugins...`);
      }
      return result;
    })
  );

  return Object.fromEntries(
    results
      .filter((result): result is [string, PluginConfig] => result !== undefined)
      .filter(([, v]) => v != null)
  ) as ReadonlyDeep<Record<string, PluginConfig>>;
}

export type ParsePluginsOptions = SetOptional<
  {
    vencordPluginsDir: string;
    equicordPluginsDir: string;
  },
  'vencordPluginsDir' | 'equicordPluginsDir'
>;

export async function parsePlugins(
  sourcePath: string,
  options: ParsePluginsOptions = {}
): Promise<ParsedPluginsResult> {
  const validatedOptions = ParsePluginsOptionsSchema.parse(options);
  const vencordPluginsDir =
    validatedOptions.vencordPluginsDir ?? CLI_CONFIG.directories.vencordPlugins;
  const equicordPluginsDir =
    validatedOptions.equicordPluginsDir ?? CLI_CONFIG.directories.equicordPlugins;
  const pluginsPath = normalize(join(sourcePath, vencordPluginsDir));
  const equicordPluginsPath = normalize(join(sourcePath, equicordPluginsDir));

  const [hasVencordPlugins, hasEquicordPlugins] = await Promise.all([
    fse.pathExists(pluginsPath),
    fse.pathExists(equicordPluginsPath),
  ]);
  if (!hasVencordPlugins && !hasEquicordPlugins) {
    throw new Error(
      `No plugins directories found. Expected one of:\n  - ${pluginsPath}\n  - ${equicordPluginsPath}`
    );
  }

  const project = await createProject(sourcePath);
  const typeChecker = project.getTypeChecker();
  const isTTY = process.stdout.isTTY;

  const parseVencordPlugins = () =>
    parsePluginsFromDirectory(pluginsPath, project, typeChecker, isTTY);
  const parseEquicordPlugins = () =>
    parsePluginsFromDirectory(equicordPluginsPath, project, typeChecker, isTTY);

  const [vencordPlugins, equicordPlugins] = await match([
    hasVencordPlugins,
    hasEquicordPlugins,
  ] as const)
    .with([true, true], async () => [await parseVencordPlugins(), await parseEquicordPlugins()])
    .with([true, false], async () => [
      await parseVencordPlugins(),
      {} as ReadonlyDeep<Record<string, PluginConfig>>,
    ])
    .with([false, true], async () => [
      {} as ReadonlyDeep<Record<string, PluginConfig>>,
      await parseEquicordPlugins(),
    ])
    .with([false, false], () => {
      throw new Error('unreachable');
    })
    .exhaustive();

  return { vencordPlugins, equicordPlugins };
}

const PLUGIN_RENAME_MAP: Record<string, string> = { oneko: 'CursorBuddy' };

export async function extractMigrations(repoPath: string): Promise<Record<string, string | null>> {
  try {
    const { extractDeprecationsFromGit } = await import('@nixcord/git-analyzer');
    const deprecations = await extractDeprecationsFromGit(repoPath);

    const migrations: Record<string, string | null> = {};

    for (const dep of deprecations) {
      const key = `${dep.plugin}.${dep.setting}`;
      migrations[key] = null;
    }

    return migrations;
  } catch {
    return {};
  }
}

export async function updateDeprecatedPlugins(
  migrations: Record<string, string | null>,
  pluginsDir: string,
  verbose: boolean,
  logger: Logger
): Promise<void> {
  try {
    const deprecatedPath = join(pluginsDir, 'deprecated.nix');
    let existingDeprecated: Record<string, string | null> = {};

    if (await fse.pathExists(deprecatedPath)) {
      try {
        const content = await fse.readFile(deprecatedPath, 'utf-8');
        const attrsetMatch = content.match(/\{\s*([^}]*)\s*\}/);
        if (attrsetMatch?.[1]) {
          for (const entry of attrsetMatch[1].split(';').filter((line) => line.trim())) {
            const match = entry.trim().match(/(\w+)\s*=\s*(null|"[^"]*");?/);
            if (match?.[1] && match?.[2])
              existingDeprecated[match[1]] =
                match[2] === 'null' ? null : match[2].replace(/"/g, '');
          }
        }
      } catch (error) {
        if (verbose) logger.warn(`Failed to parse existing deprecated.nix: ${error}`);
      }
    }

    if (Object.keys(migrations).length === 0 && Object.keys(existingDeprecated).length === 0)
      return;

    const updatedDeprecated = { ...existingDeprecated, ...migrations };
    const entries = Object.entries(updatedDeprecated)
      .map(([oldName, newName]) => `  ${oldName} = ${newName === null ? 'null' : `"${newName}"`};`)
      .join('\n');
    const nixCode = `${AUTO_GENERATED_HEADER}\n\n{\n${entries}\n}\n`;

    await fse.writeFile(deprecatedPath, nixCode);

    if (verbose && Object.keys(migrations).length > 0) {
      logger.info(`Updated deprecated.nix with ${Object.keys(migrations).length} migrations`);
    }
  } catch (error) {
    if (verbose) logger.warn(`Failed to update deprecated.nix: ${error}`);
  }
}

export function categorizePlugins(
  vencordResult: Readonly<ParsedPluginsResult>,
  equicordResult?: Readonly<ParsedPluginsResult>
): {
  readonly generic: ReadonlyDeep<Record<string, PluginConfig>>;
  readonly vencordOnly: ReadonlyDeep<Record<string, PluginConfig>>;
  readonly equicordOnly: ReadonlyDeep<Record<string, PluginConfig>>;
} {
  const vencordPlugins = vencordResult.vencordPlugins;
  const equicordSharedPlugins = equicordResult?.vencordPlugins ?? {};
  const equicordOnlyPlugins = equicordResult?.equicordPlugins ?? {};

  const equicordDirectoryMap = Object.entries(equicordSharedPlugins)
    .filter(([, config]) => config.directoryName !== undefined)
    .reduce((acc, [name, config]) => {
      acc.set(config.directoryName!.toLowerCase(), name);
      return acc;
    }, new Map<string, string>());

  const pluginMatches = Object.entries(vencordPlugins).map(([name, config]) => {
    const getEquicordConfig = (): PluginConfig | undefined => {
      const existing = equicordSharedPlugins[name];
      if (existing) return existing;

      const renamedPlugin = PLUGIN_RENAME_MAP[name];
      if (renamedPlugin) {
        return equicordOnlyPlugins[renamedPlugin] || equicordSharedPlugins[renamedPlugin];
      }

      const dirName = config?.directoryName;
      if (typeof dirName === 'string') {
        const equicordName = equicordDirectoryMap.get(dirName.toLowerCase());
        if (equicordName) {
          return equicordSharedPlugins[equicordName];
        }
      }

      return undefined;
    };

    return { name, config, equicordConfig: getEquicordConfig() };
  });

  const genericMatches = pluginMatches.filter(
    ({ equicordConfig }) => equicordConfig !== undefined && !equicordConfig.isModified
  );
  const vencordMatches = pluginMatches.filter(
    ({ equicordConfig }) => equicordConfig === undefined || equicordConfig.isModified
  );

  const genericTuples = genericMatches.map(
    ({ name, equicordConfig }) => [name, equicordConfig!] as [string, PluginConfig]
  );

  const vencordTuples = vencordMatches.map(
    ({ name, config }) => [name, config] as [string, PluginConfig]
  );

  const matchedEquicordPluginNames = new Set(
    genericMatches
      .map(({ equicordConfig }) => equicordConfig!.name)
      .filter((name) => name !== undefined)
  );

  const modifiedEquicordSharedPluginNames = new Set(
    vencordMatches
      .map(({ equicordConfig }) => equicordConfig?.name)
      .filter((name): name is string => name !== undefined)
  );

  const filteredEquicordOnly = Object.fromEntries(
    Object.entries(equicordOnlyPlugins).filter(
      ([name]) =>
        !matchedEquicordPluginNames.has(name) && !modifiedEquicordSharedPluginNames.has(name)
    )
  );

  const modifiedSharedPlugins = Object.fromEntries(
    Object.entries(equicordSharedPlugins).filter(([name]) =>
      modifiedEquicordSharedPluginNames.has(name)
    )
  );

  return {
    generic: filterNullish(Object.fromEntries(genericTuples)) as ReadonlyDeep<
      Record<string, PluginConfig>
    >,
    vencordOnly: filterNullish(Object.fromEntries(vencordTuples)) as ReadonlyDeep<
      Record<string, PluginConfig>
    >,
    equicordOnly: filterNullish({
      ...filteredEquicordOnly,
      ...modifiedSharedPlugins,
    }) as ReadonlyDeep<Record<string, PluginConfig>>,
  };
}
