import { Project, SyntaxKind } from 'ts-morph';
import pLimit from 'p-limit';
import { basename, dirname, normalize, join } from 'pathe';
import fse from 'fs-extra';
import fg from 'fast-glob';
import { z } from 'zod';
import type {
  ReadonlyDeep,
  SetOptional,
  PluginConfig,
  ParsedPluginsResult,
  PluginSetting,
  SettingRename,
  PluginRename,
  ParseDiagnostic,
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
const PLUGIN_SOURCE_GLOB_PATTERN = '**/*.{ts,tsx}';
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
  pluginRenames: PluginRename[];
  diagnostics: ParseDiagnostic[];
}

async function parseSinglePlugin(
  pluginDir: string,
  pluginPath: string,
  project: Project,
  typeChecker: ReturnType<Project['getTypeChecker']>
): Promise<SinglePluginResult | undefined> {
  const path = await findPluginSourceFile(pluginPath);
  if (!path) return undefined;

  const getOrAddSourceFile = (filePath: string) =>
    project.getSourceFile(filePath) ?? project.addSourceFileAtPath(filePath);

  const sourceFile = getOrAddSourceFile(path);
  if (!sourceFile) return undefined;
  const pluginSourceFiles = await fg(PLUGIN_SOURCE_GLOB_PATTERN, {
    cwd: pluginPath,
    absolute: true,
    onlyFiles: true,
  });
  const allSourceFiles = pluginSourceFiles.map((filePath) =>
    getOrAddSourceFile(normalize(filePath))
  );
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
    // Try conventional settings files first for deterministic behavior.
    const settingsPathTsx = normalize(join(pluginPath, 'settings.tsx'));
    const settingsPathTs = normalize(join(pluginPath, 'settings.ts'));

    const settingsPath = (await fse.pathExists(settingsPathTsx))
      ? settingsPathTsx
      : (await fse.pathExists(settingsPathTs))
        ? settingsPathTs
        : null;

    if (settingsPath) {
      settingsCall = findDefinePluginSettings(getOrAddSourceFile(settingsPath));
    }
  }

  if (settingsCall === undefined) {
    for (const filePath of pluginSourceFiles) {
      const candidate = findDefinePluginSettings(getOrAddSourceFile(normalize(filePath)));
      if (candidate) {
        settingsCall = candidate;
        break;
      }
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

  const diagnostics: ParseDiagnostic[] = [];
  if (settingsCall !== undefined && Object.keys(settings).length === 0) {
    diagnostics.push({
      pluginName,
      filePath: settingsCall.getSourceFile().getFilePath(),
      kind: 'empty-settings-extraction',
      message: `Found definePluginSettings() for ${pluginName}, but extracted no settings`,
    });
  }

  // Extract migratePluginSetting(pluginName, oldSetting, newSetting) calls from all plugin source files.
  const settingRenames: SettingRename[] = [];
  const migrateCalls = allSourceFiles.flatMap(findMigratePluginSettingCalls);
  for (const call of migrateCalls) {
    const args = call.getArguments();
    if (args.length >= 3) {
      const callPluginName = args[0].asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
      const oldSetting = args[1].asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
      const newSetting = args[2].asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
      if (callPluginName && newSetting && oldSetting) {
        settingRenames.push({ pluginName: callPluginName, oldSetting, newSetting });
      }
    }
  }

  const pluginRenames: PluginRename[] = [];
  const pluginRenameCalls = allSourceFiles.flatMap((source) =>
    source
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter((call) => call.getExpression().getText() === 'migratePluginSettings')
  );
  for (const call of pluginRenameCalls) {
    const args = call.getArguments();
    const newName = args[0]?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
    if (!newName) continue;
    for (const oldArg of args.slice(1)) {
      const oldName = oldArg.asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
      if (oldName) pluginRenames.push({ oldName, newName });
    }
  }

  const pluginConfig: PluginConfig = {
    name: pluginName,
    settings,
    directoryName: pluginDir,
    ...(pluginInfo.description ? { description: pluginInfo.description } : {}),
    ...(pluginInfo.isModified !== undefined ? { isModified: pluginInfo.isModified } : {}),
  };

  return { entry: [pluginName, pluginConfig], settingRenames, pluginRenames, diagnostics };
}

interface DirectoryParseResult {
  plugins: ReadonlyDeep<Record<string, PluginConfig>>;
  settingRenames: SettingRename[];
  pluginRenames: PluginRename[];
  diagnostics: ParseDiagnostic[];
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
  const allPluginRenames: PluginRename[] = [];
  const allDiagnostics: ParseDiagnostic[] = [];
  const pluginEntries: [string, PluginConfig][] = [];

  for (const result of results) {
    if (result) {
      pluginEntries.push(result.entry);
      allSettingRenames.push(...result.settingRenames);
      allPluginRenames.push(...result.pluginRenames);
      allDiagnostics.push(...result.diagnostics);
    }
  }

  return {
    plugins: Object.fromEntries(pluginEntries.filter(([, v]) => v != null)) as ReadonlyDeep<
      Record<string, PluginConfig>
    >,
    settingRenames: allSettingRenames,
    pluginRenames: allPluginRenames,
    diagnostics: allDiagnostics,
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
    pluginRenames: [],
    diagnostics: [],
  };

  const vencordResult = hasVencordPlugins ? await parseVencordPlugins() : emptyResult;
  const equicordResult = hasEquicordPlugins ? await parseEquicordPlugins() : emptyResult;

  return {
    vencordPlugins: vencordResult.plugins,
    equicordPlugins: equicordResult.plugins,
    settingRenames: [...vencordResult.settingRenames, ...equicordResult.settingRenames],
    pluginRenames: [...vencordResult.pluginRenames, ...equicordResult.pluginRenames],
    diagnostics: [...vencordResult.diagnostics, ...equicordResult.diagnostics],
  };
}
