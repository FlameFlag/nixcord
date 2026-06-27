import { findDefinePluginSettings } from '@nixcord/ast';
import fg from 'fast-glob';
import fse from 'fs-extra';
import { join, normalize } from 'pathe';
import type { Project, SourceFile } from 'ts-morph';

const PLUGIN_SOURCE_FILE_PATTERNS = ['index.tsx', 'index.ts', 'settings.ts'] as const;
const PLUGIN_SETTINGS_FILE_PATTERNS = ['settings.tsx', 'settings.ts'] as const;
const PLUGIN_SOURCE_GLOB_PATTERN = '**/*.{ts,tsx}';

export interface PluginSourceFileSession {
  readonly settingsSourceFile?: SourceFile;
  readonly sourceFile: SourceFile;
  readonly allSourceFiles: readonly SourceFile[];
  readonly cleanup: () => void;
}

export async function findPluginSourceFile(pluginPath: string): Promise<string | undefined> {
  for (const pattern of PLUGIN_SOURCE_FILE_PATTERNS) {
    const filePath = normalize(join(pluginPath, pattern));
    if (await fse.pathExists(filePath)) return filePath;
  }
  return undefined;
}

export async function findSettingsSourceFile(pluginPath: string): Promise<string | undefined> {
  for (const fileName of PLUGIN_SETTINGS_FILE_PATTERNS) {
    const filePath = normalize(join(pluginPath, fileName));
    if (await fse.pathExists(filePath)) return filePath;
  }
  return undefined;
}

export async function createPluginSourceFileSession(
  pluginPath: string,
  entryPath: string,
  settingsPath: string | undefined,
  project: Project
): Promise<PluginSourceFileSession> {
  const addedSourceFiles: SourceFile[] = [];
  const getOrAddSourceFile = (filePath: string) => {
    const existing = project.getSourceFile(filePath);
    if (existing) return existing;
    const sourceFile = project.addSourceFileAtPath(filePath);
    addedSourceFiles.push(sourceFile);
    return sourceFile;
  };

  const settingsSourceFile = settingsPath ? getOrAddSourceFile(settingsPath) : undefined;
  const sourceFile = getOrAddSourceFile(entryPath);
  const pluginSourceFiles = await fg(PLUGIN_SOURCE_GLOB_PATTERN, {
    cwd: pluginPath,
    absolute: true,
    onlyFiles: true,
  });
  const allSourceFiles = pluginSourceFiles.map((filePath) =>
    getOrAddSourceFile(normalize(filePath))
  );

  return {
    settingsSourceFile,
    sourceFile,
    allSourceFiles,
    cleanup: () => {
      for (const sourceFile of addedSourceFiles.slice().reverse()) {
        project.removeSourceFile(sourceFile);
      }
    },
  };
}

const uniqueSourceFiles = (sourceFiles: readonly (SourceFile | undefined)[]): SourceFile[] => {
  const seen = new Set<string>();
  return sourceFiles.filter((sourceFile): sourceFile is SourceFile => {
    if (!sourceFile) return false;
    const filePath = sourceFile.getFilePath();
    if (seen.has(filePath)) return false;
    seen.add(filePath);
    return true;
  });
};

export const findPluginSettingsCall = (
  session: PluginSourceFileSession
): ReturnType<typeof findDefinePluginSettings> | undefined => {
  for (const sourceFile of uniqueSourceFiles([
    session.settingsSourceFile,
    session.sourceFile,
    ...session.allSourceFiles,
  ])) {
    const settingsCall = findDefinePluginSettings(sourceFile);
    if (settingsCall) return settingsCall;
  }
  return undefined;
};
