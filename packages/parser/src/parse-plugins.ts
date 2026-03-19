import { Project, SyntaxKind } from 'ts-morph';
import pLimit from 'p-limit';
import { basename, dirname, normalize, join } from 'pathe';
import fse from 'fs-extra';
import fg from 'fast-glob';
import { z } from 'zod';
import type { ReadonlyDeep, SetOptional } from 'type-fest';
import type {
  PluginConfig,
  ParsedPluginsResult,
  PluginSetting,
  SettingRename,
} from '@nixcord/shared';
import { extractPluginInfo } from '@nixcord/ast';
import {
  findDefinePluginSettings,
  findDefinePluginCall,
  findMigratePluginSettingCalls,
} from '@nixcord/ast';
import { extractSettingsFromCall, extractSettingsFromObject } from '@nixcord/ast';
import { CLI_CONFIG } from '@nixcord/shared';
import { createProject } from './project.js';

const PLUGIN_SOURCE_FILE_PATTERNS = ['index.tsx', 'index.ts', 'settings.ts'] as const;
const PARALLEL_PROCESSING_LIMIT = 5;
const PROGRESS_REPORT_INTERVAL = 10;
const PLUGIN_DIR_SEPARATOR_PATTERN = /[-_]/;
const PLUGIN_FILE_GLOB_PATTERN = '*/index.{ts,tsx}';
const CURRENT_DIRECTORY = '.';

const ParsePluginsOptionsSchema = z.object({
  vencordPluginsDir: z.string().min(1).optional(),
  equicordPluginsDir: z.string().min(1).optional(),
});

async function findPluginSourceFile(pluginPath: string): Promise<string | undefined> {
  for (const pattern of PLUGIN_SOURCE_FILE_PATTERNS) {
    const filePath = normalize(join(pluginPath, pattern));
    if (await fse.pathExists(filePath)) return filePath;
  }
  return undefined;
}

interface SinglePluginResult {
  entry: [string, PluginConfig];
  settingRenames: SettingRename[];
}

async function parseSinglePlugin(
  pluginDir: string,
  pluginPath: string,
  project: Project,
  typeChecker: ReturnType<Project['getTypeChecker']>
): Promise<SinglePluginResult | undefined> {
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

  let settings: Record<string, PluginSetting | PluginConfig> =
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
          const optionsProp = pluginObj
            .getProperty('options')
            ?.asKind(SyntaxKind.PropertyAssignment);
          const optionsInit = optionsProp
            ?.getInitializer()
            ?.asKind(SyntaxKind.ObjectLiteralExpression);
          if (optionsInit) {
            settings = extractSettingsFromObject(
              optionsInit,
              typeChecker,
              project.getProgram(),
              true
            );
          }
        }
      }
    }
  }

  // Extract migratePluginSetting calls from all source files
  const settingRenames: SettingRename[] = [];
  const migrateCalls = findMigratePluginSettingCalls(sourceFile);
  for (const call of migrateCalls) {
    const args = call.getArguments();
    if (args.length >= 3) {
      const callPluginName = args[0].asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
      const newSetting = args[1].asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
      const oldSetting = args[2].asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
      if (callPluginName && newSetting && oldSetting) {
        settingRenames.push({ pluginName: callPluginName, oldSetting, newSetting });
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

  return { entry: [pluginName, pluginConfig], settingRenames };
}

interface DirectoryParseResult {
  plugins: ReadonlyDeep<Record<string, PluginConfig>>;
  settingRenames: SettingRename[];
}

async function parsePluginsFromDirectory(
  pluginsPath: string,
  project: Project,
  typeChecker: ReturnType<Project['getTypeChecker']>,
  isTTY: boolean
): Promise<DirectoryParseResult> {
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

  const allSettingRenames: SettingRename[] = [];
  const pluginEntries: [string, PluginConfig][] = [];

  for (const result of results) {
    if (result) {
      pluginEntries.push(result.entry);
      allSettingRenames.push(...result.settingRenames);
    }
  }

  return {
    plugins: Object.fromEntries(pluginEntries.filter(([, v]) => v != null)) as ReadonlyDeep<
      Record<string, PluginConfig>
    >,
    settingRenames: allSettingRenames,
  };
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

  const emptyResult: DirectoryParseResult = {
    plugins: {} as ReadonlyDeep<Record<string, PluginConfig>>,
    settingRenames: [],
  };

  const vencordResult = hasVencordPlugins ? await parseVencordPlugins() : emptyResult;
  const equicordResult = hasEquicordPlugins ? await parseEquicordPlugins() : emptyResult;

  return {
    vencordPlugins: vencordResult.plugins,
    equicordPlugins: equicordResult.plugins,
    settingRenames: [...vencordResult.settingRenames, ...equicordResult.settingRenames],
  };
}
