import { join, dirname } from 'node:path';
import fse from 'fs-extra';

export async function createTsConfig(
  tempDir: string,
  options?: {
    baseUrl?: string;
    include?: string[];
  }
): Promise<void> {
  interface TsConfigJson {
    compilerOptions: Record<string, unknown>;
    include?: string[];
  }

  const config: TsConfigJson = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      jsx: 'react',
      allowJs: true,
      skipLibCheck: true,
    },
  };

  if (typeof options?.baseUrl === 'string') {
    config.compilerOptions.baseUrl = options.baseUrl;
  }

  if (Array.isArray(options?.include)) {
    config.include = options.include;
  }

  await fse.writeFile(join(tempDir, 'tsconfig.json'), JSON.stringify(config));
}

export async function createPluginFile(
  pluginDir: string,
  filename: string,
  content: string
): Promise<void> {
  await fse.ensureDir(pluginDir);
  await fse.writeFile(join(pluginDir, filename), content);
}

export async function createPlugin(
  tempDir: string,
  pluginName: string,
  config: {
    indexContent: string;
    settingsContent?: string;
    settingsFilename?: string;
    additionalFiles?: Array<{ path: string; content: string }>;
  }
): Promise<string> {
  const pluginsDir = join(tempDir, 'src', 'plugins');
  const pluginDir = join(pluginsDir, pluginName);

  await fse.ensureDir(pluginDir);
  await createPluginFile(pluginDir, 'index.ts', config.indexContent);

  if (config.settingsContent) {
    const settingsFilename = config.settingsFilename || 'settings.ts';
    await createPluginFile(pluginDir, settingsFilename, config.settingsContent);
  }

  if (config.additionalFiles) {
    for (const file of config.additionalFiles) {
      const fileDir = dirname(join(pluginDir, file.path));
      await fse.ensureDir(fileDir);
      await fse.writeFile(join(pluginDir, file.path), file.content);
    }
  }

  return pluginDir;
}
