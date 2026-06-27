import {
  extractPluginInfo,
  extractSettingsFromCall,
  extractSettingsFromCallDetailed,
  extractSettingsFromObject,
  findDefinePluginCall,
} from '@nixcord/ast';
import type {
  ParseDiagnostic,
  ParsedPluginsResult,
  PluginConfig,
  PluginRename,
  PluginSetting,
  ReadonlyDeep,
  SetOptional,
  SettingRename,
} from '@nixcord/shared';
import { CLI_CONFIG } from '@nixcord/shared';
import fg from 'fast-glob';
import fse from 'fs-extra';
import pLimit from 'p-limit';
import { basename, dirname, join, normalize } from 'pathe';
import { type Project, SyntaxKind } from 'ts-morph';
import { z } from 'zod';
import { diagnosticsFromSettingsExtraction } from './diagnostics.js';
import {
  createPluginSourceFileSession,
  findPluginSettingsCall,
  findPluginSourceFile,
  findSettingsSourceFile,
} from './plugin-session.js';
import { createProject } from './project.js';
import { extractPluginRenames, extractSettingRenames } from './renames.js';

const SERIAL_PROJECT_MUTATION_LIMIT = 1;
const PROGRESS_REPORT_INTERVAL = 10;
const PLUGIN_DIR_SEPARATOR_PATTERN = /[-_]/;
const PLUGIN_FILE_GLOB_PATTERN = '*/index.{ts,tsx}';
const CURRENT_DIRECTORY = '.';

const ParsePluginsOptionsSchema = z.object({
  vencordPluginsDir: z.string().min(1).optional(),
  equicordPluginsDir: z.string().min(1).optional(),
});

interface SinglePluginResult {
  kind: 'parsed';
  entry: [string, PluginConfig];
  settingRenames: SettingRename[];
  pluginRenames: PluginRename[];
  diagnostics: ParseDiagnostic[];
}

interface SkippedPluginResult {
  kind: 'skipped';
  diagnostics: ParseDiagnostic[];
}

interface FailedPluginResult {
  kind: 'failed';
  diagnostics: ParseDiagnostic[];
}

type SinglePluginParseResult = SinglePluginResult | SkippedPluginResult | FailedPluginResult;

interface DirectoryParseResult {
  plugins: ReadonlyDeep<Record<string, PluginConfig>>;
  settingRenames: SettingRename[];
  pluginRenames: PluginRename[];
  diagnostics: ParseDiagnostic[];
}

const emptyDirectoryResult = (): DirectoryParseResult => ({
  plugins: {} as ReadonlyDeep<Record<string, PluginConfig>>,
  settingRenames: [],
  pluginRenames: [],
  diagnostics: [],
});

const inferPluginName = (pluginDir: string, pluginInfoName: string | undefined): string =>
  pluginInfoName ||
  pluginDir
    .split(PLUGIN_DIR_SEPARATOR_PATTERN)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');

const skippedPluginResult = (
  pluginDir: string,
  pluginPath: string,
  message: string
): SkippedPluginResult => ({
  kind: 'skipped',
  diagnostics: [
    {
      pluginName: pluginDir,
      filePath: pluginPath,
      kind: 'skipped-plugin',
      message,
    },
  ],
});

const failedPluginResult = (
  pluginDir: string,
  pluginPath: string,
  error: unknown
): FailedPluginResult => ({
  kind: 'failed',
  diagnostics: [
    {
      pluginName: pluginDir,
      filePath: pluginPath,
      kind: 'failed-plugin',
      message: `Failed to parse plugin ${pluginDir}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    },
  ],
});

const extractInlineDefinePluginOptions = (
  project: Project,
  sourceFile: Parameters<typeof findDefinePluginCall>[0],
  pluginTypeChecker: ReturnType<Project['getTypeChecker']>
): Record<string, PluginSetting | PluginConfig> => {
  const definePluginCallExpr = findDefinePluginCall(sourceFile);
  const pluginObj = definePluginCallExpr
    ?.getArguments()[0]
    ?.asKind(SyntaxKind.ObjectLiteralExpression);
  const optionsInit = pluginObj
    ?.getProperty('options')
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.ObjectLiteralExpression);

  return optionsInit
    ? extractSettingsFromObject(optionsInit, pluginTypeChecker, project.getProgram(), true)
    : {};
};

async function parseSinglePlugin(
  pluginDir: string,
  pluginPath: string,
  project: Project
): Promise<SinglePluginParseResult> {
  const entryPath = await findPluginSourceFile(pluginPath);
  if (!entryPath) {
    return skippedPluginResult(
      pluginDir,
      pluginPath,
      `Skipped plugin ${pluginDir}: no supported entry source file found`
    );
  }

  const settingsPath = await findSettingsSourceFile(pluginPath);
  let session: Awaited<ReturnType<typeof createPluginSourceFileSession>> | undefined;

  try {
    session = await createPluginSourceFileSession(pluginPath, entryPath, settingsPath, project);
    const pluginTypeChecker = project.getTypeChecker();
    const pluginInfo = extractPluginInfo(session.sourceFile, pluginTypeChecker);
    const pluginName = inferPluginName(pluginDir, pluginInfo.name);

    if (!pluginName) {
      return skippedPluginResult(
        pluginDir,
        pluginPath,
        `Skipped plugin ${pluginDir}: plugin name could not be inferred`
      );
    }

    const settingsCall = findPluginSettingsCall(session);
    const settingsExtraction =
      settingsCall !== undefined
        ? extractSettingsFromCallDetailed(
            settingsCall,
            pluginTypeChecker,
            project.getProgram(),
            true
          )
        : undefined;
    let settings: Record<string, PluginSetting | PluginConfig> = settingsExtraction?.items ?? {};

    if (settingsCall === undefined && Object.keys(settings).length === 0) {
      settings = extractInlineDefinePluginOptions(project, session.sourceFile, pluginTypeChecker);
    }

    const diagnostics =
      settingsCall !== undefined && settingsExtraction !== undefined
        ? diagnosticsFromSettingsExtraction(pluginName, settingsCall, settingsExtraction)
        : [];

    const pluginConfig: PluginConfig = {
      name: pluginName,
      settings,
      directoryName: pluginDir,
      ...(pluginInfo.description ? { description: pluginInfo.description } : {}),
      ...(pluginInfo.isModified !== undefined ? { isModified: pluginInfo.isModified } : {}),
    };

    return {
      kind: 'parsed',
      entry: [pluginName, pluginConfig],
      settingRenames: extractSettingRenames(session.allSourceFiles),
      pluginRenames: extractPluginRenames(session.allSourceFiles),
      diagnostics,
    };
  } catch (error) {
    return failedPluginResult(pluginDir, pluginPath, error);
  } finally {
    session?.cleanup();
  }
}

async function parsePluginsFromDirectory(
  pluginsPath: string,
  project: Project,
  isTTY: boolean
): Promise<DirectoryParseResult> {
  const pluginDirs = [
    ...new Set(
      (
        await fg(PLUGIN_FILE_GLOB_PATTERN, { cwd: pluginsPath, absolute: false, onlyFiles: true })
      ).map(dirname)
    ),
  ].filter((dir) => dir !== CURRENT_DIRECTORY);

  if (!isTTY)
    console.log(`Found ${pluginDirs.length} plugin directories in ${basename(pluginsPath)}`);

  const limit = pLimit(SERIAL_PROJECT_MUTATION_LIMIT);
  let processed = 0;

  const results = await Promise.all(
    pluginDirs.map(async (pluginDir) => {
      const result = await limit(() =>
        parseSinglePlugin(pluginDir, normalize(join(pluginsPath, pluginDir)), project)
      );
      processed++;
      if (!isTTY && processed % PROGRESS_REPORT_INTERVAL === 0) {
        console.log(`Processed ${processed}/${pluginDirs.length} plugins...`);
      }
      return result;
    })
  );

  const allSettingRenames: SettingRename[] = [];
  const allPluginRenames: PluginRename[] = [];
  const allDiagnostics: ParseDiagnostic[] = [];
  const pluginEntries: [string, PluginConfig][] = [];

  for (const result of results) {
    allDiagnostics.push(...result.diagnostics);
    if (result.kind === 'parsed') {
      pluginEntries.push(result.entry);
      allSettingRenames.push(...result.settingRenames);
      allPluginRenames.push(...result.pluginRenames);
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
  const isTTY = process.stdout.isTTY;
  const emptyResult = emptyDirectoryResult();

  const vencordResult = hasVencordPlugins
    ? await parsePluginsFromDirectory(pluginsPath, project, isTTY)
    : emptyResult;
  const equicordResult = hasEquicordPlugins
    ? await parsePluginsFromDirectory(equicordPluginsPath, project, isTTY)
    : emptyResult;

  return {
    vencordPlugins: vencordResult.plugins,
    equicordPlugins: equicordResult.plugins,
    settingRenames: [...vencordResult.settingRenames, ...equicordResult.settingRenames],
    pluginRenames: [...vencordResult.pluginRenames, ...equicordResult.pluginRenames],
    diagnostics: [...vencordResult.diagnostics, ...equicordResult.diagnostics],
  };
}
