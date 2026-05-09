import { describe, test, expect } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import fse from 'fs-extra';
import { parsePlugins } from '../../src/index.js';
import type { PluginSetting } from '@nixcord/shared';
import { createTsConfig, createPluginFile, createPlugin } from '../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// findPluginSourceFile() is tested indirectly through parseSinglePlugin tests
// No need for separate tests since it's a private function

describe('parseSinglePlugin()', () => {
  test('parses valid plugin', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'valid-plugin', {
        indexContent: `export function definePlugin(definition: { name: string; description: string }) {
          return definition;
        }

        export function definePluginSettings(settings: Record<string, unknown>) {
          return settings;
        }

        export const plugin = definePlugin({
          name: "Valid Plugin",
          description: "A valid test plugin",
        });

        export const settings = definePluginSettings({
          setting: {
            type: "STRING",
            description: "A setting",
            default: "value",
          },
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin = result.vencordPlugins['Valid Plugin'];
      expect(plugin).toBeDefined();
      expect(plugin?.settings.setting).toBeDefined();
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('handles missing source file', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      const pluginsDir = join(tempDir, 'src', 'plugins');
      const pluginDir = join(pluginsDir, 'missing-plugin');
      await fse.ensureDir(pluginDir);
      // Don't create index.ts

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      // Plugin without source file should not be in results
      expect(result.vencordPlugins['missing-plugin']).toBeUndefined();
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('handles missing plugin name', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'no-name-plugin', {
        indexContent: `export function definePluginSettings(settings: Record<string, unknown>) {
          return settings;
        }

        export const settings = definePluginSettings({
          setting: {
            type: "STRING",
            description: "A setting",
          },
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      // Plugin name should be derived from directory name
      const plugin = result.vencordPlugins['NoNamePlugin'];
      expect(plugin).toBeDefined();
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('finds settings in nested plugin source files', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'nested-settings-plugin', {
        indexContent: `import definePlugin from "@utils/types";
        import { settings } from "./settings/store";

        export default definePlugin({
          name: "NestedSettings",
          description: "Plugin with nested settings module",
          settings,
        });`,
        additionalFiles: [
          {
            path: 'settings/store.ts',
            content: `import { definePluginSettings } from "@api/Settings";
            import { OptionType } from "@utils/types";

            export const settings = definePluginSettings({
              nestedSetting: {
                type: OptionType.BOOLEAN,
                description: "Nested setting",
                default: true,
              },
            });`,
          },
        ],
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin = result.vencordPlugins['NestedSettings'];
      expect(plugin).toBeDefined();
      expect((plugin?.settings.nestedSetting as PluginSetting).default).toBe(true);
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('extracts generated Object.entries(...).reduce settings', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'generated-settings-plugin', {
        indexContent: `import definePlugin, { OptionType } from "@utils/types";
        import { definePluginSettings } from "@api/Settings";

        const UrlReplacementRules = {
          spotify: { description: "Open Spotify links in app" },
          steam: { description: "Open Steam links in app" },
        };

        const pluginSettings = definePluginSettings(
          Object.entries(UrlReplacementRules).reduce((acc, [key, rule]) => {
            acc[key] = {
              type: OptionType.BOOLEAN,
              description: rule.description,
              default: true,
            };
            return acc;
          }, {} as Record<string, unknown>)
        );

        export default definePlugin({
          name: "GeneratedSettings",
          description: "Plugin with generated settings",
          settings: pluginSettings,
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin = result.vencordPlugins['GeneratedSettings'];
      expect(plugin).toBeDefined();
      expect((plugin?.settings.spotify as PluginSetting).type).toBe('types.bool');
      expect((plugin?.settings.spotify as PluginSetting).description).toBe(
        'Open Spotify links in app'
      );
      expect((plugin?.settings.steam as PluginSetting).default).toBe(true);
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('extracts plugin renames from migratePluginSettings calls', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'plugin-migration-plugin', {
        indexContent: `import definePlugin from "@utils/types";
        import { migratePluginSettings } from "@api/Settings";

        migratePluginSettings("NewPlugin", "OldPlugin", "OlderPlugin");

        export default definePlugin({
          name: "NewPlugin",
          description: "Plugin with rename migration",
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      expect(result.pluginRenames).toEqual(
        expect.arrayContaining([
          { oldName: 'OldPlugin', newName: 'NewPlugin' },
          { oldName: 'OlderPlugin', newName: 'NewPlugin' },
        ])
      );
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('extracts migratePluginSetting calls using upstream argument order', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'setting-migration-plugin', {
        indexContent: `import definePlugin from "@utils/types";
        import { migratePluginSetting } from "@api/Settings";

        migratePluginSetting("SettingMigration", "oldName", "newName");

        export default definePlugin({
          name: "SettingMigration",
          description: "Plugin with setting migration",
        });`,
        additionalFiles: [
          {
            path: 'migrations.ts',
            content: `import { migratePluginSetting } from "@api/Settings";
            migratePluginSetting("SettingMigration", "oldNested", "newNested");`,
          },
        ],
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      expect(result.settingRenames).toEqual(
        expect.arrayContaining([
          { pluginName: 'SettingMigration', oldSetting: 'oldName', newSetting: 'newName' },
          { pluginName: 'SettingMigration', oldSetting: 'oldNested', newSetting: 'newNested' },
        ])
      );
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('handles plugin without settings', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'no-settings-plugin', {
        indexContent: `export function definePlugin(definition: { name: string; description: string }) {
          return definition;
        }

        export const plugin = definePlugin({
          name: "No Settings Plugin",
          description: "A plugin without settings",
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin = result.vencordPlugins['No Settings Plugin'];
      expect(plugin).toBeDefined();
      expect(plugin?.settings).toEqual({});
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('handles settings in separate settings.ts file', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'test-plugin-settings-file', {
        indexContent: `import definePlugin from "@utils/types";

        export default definePlugin({
          name: "Test Plugin With Separate Settings",
          description: "Plugin with settings in separate file",
        });`,
        settingsContent: `import { definePluginSettings } from "@api/Settings";
        import { OptionType } from "@utils/types";

        export default definePluginSettings({
          enabled: {
            type: OptionType.BOOLEAN,
            description: "Enable the feature",
            default: true,
          },
          message: {
            type: OptionType.STRING,
            description: "Message to display",
            default: "Hello from settings file",
          },
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin = result.vencordPlugins['Test Plugin With Separate Settings'];
      expect(plugin).toBeDefined();
      expect(plugin?.settings.enabled).toBeDefined();
      expect(plugin?.settings.message).toBeDefined();
      expect((plugin?.settings.enabled as PluginSetting).name).toBe('enabled');
      expect((plugin?.settings.message as PluginSetting).name).toBe('message');
    } finally {
      await fse.remove(tempDir);
    }
  });
});
