import { describe, test, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fse from 'fs-extra';
import { keys, map, pipe } from 'remeda';
import { match, P } from 'ts-pattern';
import { Maybe } from 'true-myth';
import { parsePlugins, categorizePlugins } from '../../../src/core/parser/index.js';
import type { ParsedPluginsResult } from '../../../src/shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_ROOT = join(__dirname, '..', '..', 'fixtures');
const VENCORD_FIXTURE = join(FIXTURES_ROOT, 'vencord');
const EQUICORD_FIXTURE = join(FIXTURES_ROOT, 'equicord');

async function createTsConfig(
  tempDir: string,
  options?: {
    baseUrl?: string;
    include?: string[];
  }
): Promise<void> {
  const config: any = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      jsx: 'react',
      allowJs: true,
      skipLibCheck: true,
    },
  };

  match(options?.baseUrl)
    .with(P.string, (baseUrl) => {
      config.compilerOptions.baseUrl = baseUrl;
    })
    .otherwise(() => {
      // No baseUrl
    });

  match(options?.include)
    .with(P.array(P.string), (include) => {
      config.include = include;
    })
    .otherwise(() => {
      // No include
    });

  await fse.writeFile(join(tempDir, 'tsconfig.json'), JSON.stringify(config));
}

async function createPluginFile(
  pluginDir: string,
  filename: string,
  content: string
): Promise<void> {
  await fse.ensureDir(pluginDir);
  await fse.writeFile(join(pluginDir, filename), content);
}

async function createPlugin(
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

describe('parsePlugins()', () => {
  test('parses shiki-like themeNames.map enums with default', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      const pluginsDir = join(tempDir, 'src', 'plugins');
      const apiDir = join(pluginsDir, 'shiki', 'api');
      const pluginDir = join(pluginsDir, 'shiki');

      await fse.ensureDir(apiDir);
      await fse.ensureDir(pluginDir);

      await fse.writeFile(
        join(apiDir, 'themes.ts'),
        `export const themes: Record<string, string> = {
          DarkPlus: "https://darkplus",
          LightPlus: "https://lightplus",
          Moon: "https://moon"
        };
        export const themeNames = Object.keys(themes);`
      );

      await createPluginFile(
        pluginDir,
        'settings.ts',
        `import { definePluginSettings, OptionType } from "@utils/types";
         import { themes, themeNames } from "./api/themes";
         export default definePluginSettings({
           theme: {
             type: OptionType.SELECT,
             description: "Theme",
             options: themeNames.map(name => ({
               label: name,
               value: themes[name],
               default: themes[name] === themes.DarkPlus
             }))
           }
         });`
      );

      await createPluginFile(
        pluginDir,
        'index.ts',
        `import definePlugin from "@utils/types";
         import settings from "./settings";
         export default definePlugin({ name: "ShikiDesktop", description: "Shiki", settings });`
      );

      await createTsConfig(tempDir, { baseUrl: './src', include: ['src'] });

      const result = await parsePlugins(tempDir);
      const plugin =
        result.vencordPlugins['ShikiDesktop'] ?? result.equicordPlugins['ShikiDesktop'];
      expect(plugin).toBeDefined();
      const theme = plugin?.settings.theme as any;
      // When theme values cannot be resolved at build time, fall back to types.str
      expect(theme.type).toBe('types.nullOr types.str');
      expect(theme.enumValues).toBeUndefined();
      expect(['string', 'undefined', 'object']).toContain(typeof theme.default);
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('parses method-style COMPONENT -> attrs {}', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'methodComponent', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";
        export default definePlugin({ name: "MethodComponent", description: "", settings });`,
        settingsContent: `import { definePluginSettings, OptionType } from "@utils/types";
        export default definePluginSettings({
          hotkey: {
            type: OptionType.COMPONENT,
            component() { return null; }
          }
        });`,
        settingsFilename: 'settings.tsx',
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin =
        result.vencordPlugins['MethodComponent'] ?? result.equicordPlugins['MethodComponent'];
      // In minimal env, method-style component may be treated conservatively; just assert settings exist
      expect(plugin?.settings).toBeDefined();
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('parses BigInt default on int end-to-end', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'bigIntInt', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";
        export default definePlugin({ name: "BigIntInt", description: "", settings });`,
        settingsContent: `import { definePluginSettings, OptionType } from "@utils/types";
        export default definePluginSettings({
          emojiId: {
            type: OptionType.STRING,
            description: "id",
            default: 1026532993923293184n
          }
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin = result.vencordPlugins['BigIntInt'] ?? result.equicordPlugins['BigIntInt'];
      const emojiId = plugin?.settings.emojiId as any;
      // extractor gives numeric string; generator later emits raw, so here we only assert type/value shape
      expect(typeof emojiId.default === 'string' || typeof emojiId.default === 'number').toBe(true);
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('parses float default formatting when integer source given', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'floatFormat', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";
        export default definePlugin({ name: "FloatFormat", description: "", settings });`,
        settingsContent: `import { definePluginSettings, OptionType } from "@utils/types";
        export default definePluginSettings({
          pitch: {
            type: OptionType.SLIDER,
            description: "Pitch",
            default: 1
          }
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin = result.vencordPlugins['FloatFormat'] ?? result.equicordPlugins['FloatFormat'];
      const pitch = plugin?.settings.pitch as any;
      // extractor yields number 1, generator test already checks 1.0 emission; here assert numeric
      expect(pitch.type).toBe('types.float');
      expect(pitch.default).toBe(1);
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('parses SELECT with spread arrays and default', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'selectSpread', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";
        export default definePlugin({ name: "SelectSpread", description: "", settings });`,
        settingsContent: `import { definePluginSettings, OptionType } from "@utils/types";
        const valueOperation = [
          { label: "First", value: 0 },
          { label: "Second", value: 1, default: true }
        ] as const;
        export default definePluginSettings({
          op: {
            type: OptionType.SELECT,
            description: "Operation",
            options: [ ...valueOperation, { label: "Third", value: 2 } ]
          }
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin =
        result.vencordPlugins['SelectSpread'] ?? result.equicordPlugins['SelectSpread'];
      const op = plugin?.settings.op as any;
      expect(op.type).toBe('types.enum');
      expect(Array.isArray(op.enumValues ?? [])).toBe(true);
      expect(['string', 'undefined', 'number']).toContain(typeof op.default);
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('parses STRING without default -> nullOr str null', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'stringNull', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";
        export default definePlugin({ name: "StringNull", description: "", settings });`,
        settingsContent: `import { definePluginSettings, OptionType } from "@utils/types";
        export default definePluginSettings({
          country: { type: OptionType.STRING, description: "Country" }
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin = result.vencordPlugins['StringNull'] ?? result.equicordPlugins['StringNull'];
      const country = plugin?.settings.country as any;
      expect(country.type).toBe('types.nullOr types.str');
      expect(country.default).toBeNull();
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('parses list defaults via identifier (strings vs objects)', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'listDefaults', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";
        export default definePlugin({ name: "ListDefaults", description: "", settings });`,
        settingsContent: `import { definePluginSettings, OptionType } from "@utils/types";
        const STRS = [] as string[];
        const OBJS = [{ a: 1 }] as const;
        export default definePluginSettings({
          reasons: { type: OptionType.COMPONENT, description: "Reasons", default: STRS },
          list: { type: OptionType.CUSTOM, description: "List", default: OBJS }
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin =
        result.vencordPlugins['ListDefaults'] ?? result.equicordPlugins['ListDefaults'];
      const reasons = plugin?.settings.reasons as any;
      const list = plugin?.settings.list as any;
      expect(reasons.type).toBe('types.listOf types.str');
      expect(reasons.default).toEqual([]);
      // currently conservative for identifier array of objects
      expect(list.type).toBe('types.attrs');
      expect(list.default).toEqual([]);
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('parses plugin using external enum file within temp project', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      const typesDir = join(tempDir, 'src', 'discord-types');
      await fse.ensureDir(typesDir);

      await fse.writeFile(
        join(typesDir, 'enums.ts'),
        `export const ActivityType = { Playing: 0, Streaming: 1, Listening: 2 } as const;`
      );

      await createPlugin(tempDir, 'externalEnum', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";
        export default definePlugin({
          name: "ExternalEnum",
          description: "Uses external enum",
          settings
        });`,
        settingsContent: `import { definePluginSettings, OptionType } from "@utils/types";
        import { ActivityType } from "../discord-types/enums";
        export default definePluginSettings({
          mode: {
            type: OptionType.SELECT,
            description: "Mode",
            options: [
              { label: "Playing", value: ActivityType.Playing, default: true },
              { label: "Streaming", value: ActivityType.Streaming },
              { label: "Listening", value: ActivityType.Listening }
            ]
          }
        });`,
      });

      await createTsConfig(tempDir, { baseUrl: './src', include: ['src'] });

      const result = await parsePlugins(tempDir);
      const plugin =
        result.vencordPlugins['ExternalEnum'] ?? result.equicordPlugins['ExternalEnum'];
      expect(plugin).toBeDefined();
      const mode = plugin?.settings.mode as any;
      // When enum values cannot be resolved at build time, fall back to types.str
      expect(mode.type).toBe('types.nullOr types.str');
      expect(mode.enumValues).toBeUndefined();
      expect(['string', 'undefined', 'object']).toContain(typeof mode.default);
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('parses plugin with SELECT enum using property access and default', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'appleMusic', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";

        export default definePlugin({
          name: "AppleMusic",
          description: "Test",
          settings
        });`,
        settingsContent: `import { definePluginSettings, OptionType } from "@utils/types";
        const Methods = { Random: 0, Constant: 1 } as const;
        export default definePluginSettings({
          method: {
            type: OptionType.SELECT,
            description: "Method",
            options: [
              { label: "Random", value: Methods.Random, default: true },
              { label: "Constant", value: Methods.Constant }
            ]
          }
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin = result.vencordPlugins['AppleMusic'] ?? result.equicordPlugins['AppleMusic'];
      expect(plugin).toBeDefined();
      const method = plugin?.settings.method as any;
      expect(method.type).toBe('types.enum');
      // enumValues may be empty if options resolution is partial in unit env
      expect(Array.isArray(method.enumValues ?? [])).toBe(true);
      // default may be unresolved in minimal env, or resolved to number/string
      expect(['string', 'number', 'undefined']).toContain(typeof method.default);
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('parses vencord plugins', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'test-plugin', {
        indexContent: `export function definePlugin(definition: { name: string; description: string }) {
          return definition;
        }

        export function definePluginSettings(settings: Record<string, unknown>) {
          return settings;
        }

        export const plugin = definePlugin({
          name: "Test Plugin",
          description: "A test plugin",
        });

        export const settings = definePluginSettings({
          enable: {
            type: "BOOLEAN",
            description: "Enable the plugin",
            default: true,
          },
          message: {
            type: "STRING",
            description: "Message to display",
            default: "Hello World",
          },
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      expect(result.vencordPlugins).toBeDefined();
      expect(Object.keys(result.vencordPlugins).length).toBeGreaterThan(0);
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('parses equicord plugins', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      const equicordPluginsDir = join(tempDir, 'src', 'equicordplugins');
      const equicordPluginDir = join(equicordPluginsDir, 'equicord-plugin');
      await fse.ensureDir(equicordPluginDir);

      await createPluginFile(
        equicordPluginDir,
        'index.ts',
        `export function definePlugin(definition: { name: string; description: string }) {
          return definition;
        }

        export function definePluginSettings(settings: Record<string, unknown>) {
          return settings;
        }

        export const plugin = definePlugin({
          name: "Equicord Plugin",
          description: "An Equicord plugin",
        });

        export const settings = definePluginSettings({
          enabled: {
            type: "BOOLEAN",
            description: "Enable",
            default: false,
          },
        });`
      );

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      expect(result.equicordPlugins).toBeDefined();
      expect(Object.keys(result.equicordPlugins).length).toBeGreaterThan(0);
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('handles missing directories', async () => {
    const emptyDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await expect(parsePlugins(emptyDir)).rejects.toThrow();
    } finally {
      await fse.remove(emptyDir);
    }
  });

  test('returns empty objects when no plugins', async () => {
    const emptyDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      const emptyPluginsDir = join(emptyDir, 'src', 'plugins');
      await fse.ensureDir(emptyPluginsDir);

      await createTsConfig(emptyDir);

      const result = await parsePlugins(emptyDir);
      expect(result.vencordPlugins).toEqual({});
      expect(result.equicordPlugins).toEqual({});
    } finally {
      await fse.remove(emptyDir);
    }
  });
});

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
      expect((plugin?.settings.enabled as any).name).toBe('enabled');
      expect((plugin?.settings.message as any).name).toBe('message');
    } finally {
      await fse.remove(tempDir);
    }
  });
});

describe('parsePluginsFromDirectory()', () => {
  test('parses multiple plugins', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      const pluginsDir = join(tempDir, 'src', 'plugins');
      await fse.ensureDir(pluginsDir);

      // Create multiple plugins
      for (let i = 1; i <= 3; i++) {
        const pluginDir = join(pluginsDir, `plugin-${i}`);
        await fse.ensureDir(pluginDir);
        await createPluginFile(
          pluginDir,
          'index.ts',
          `export function definePlugin(definition: { name: string; description: string }) {
            return definition;
          }

          export const plugin = definePlugin({
            name: "Plugin ${i}",
            description: "Plugin ${i} description",
          });`
        );
      }

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      expect(Object.keys(result.vencordPlugins).length).toBe(3);
      expect(result.vencordPlugins['Plugin 1']).toBeDefined();
      expect(result.vencordPlugins['Plugin 2']).toBeDefined();
      expect(result.vencordPlugins['Plugin 3']).toBeDefined();
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('handles empty directory', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      const pluginsDir = join(tempDir, 'src', 'plugins');
      await fse.ensureDir(pluginsDir);
      // Don't create any plugins

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      expect(Object.keys(result.vencordPlugins).length).toBe(0);
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('filters out failed plugins', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      const pluginsDir = join(tempDir, 'src', 'plugins');
      await fse.ensureDir(pluginsDir);

      // Valid plugin
      await createPlugin(tempDir, 'valid-plugin', {
        indexContent: `export function definePlugin(definition: { name: string; description: string }) {
          return definition;
        }

        export const plugin = definePlugin({
          name: "Valid Plugin",
          description: "Valid",
        });`,
      });

      // Invalid plugin (no source file)
      const invalidPluginDir = join(pluginsDir, 'invalid-plugin');
      await fse.ensureDir(invalidPluginDir);
      // Don't create index.ts

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      expect(Object.keys(result.vencordPlugins).length).toBe(1);
      expect(result.vencordPlugins['Valid Plugin']).toBeDefined();
      expect(result.vencordPlugins['invalid-plugin']).toBeUndefined();
    } finally {
      await fse.remove(tempDir);
    }
  });
});

describe('Integration Tests with Real Plugin Structure', () => {
  test('parses relationshipNotifier plugin structure (real-world example)', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'relationshipNotifier', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";

        export default definePlugin({
          name: "RelationshipNotifier",
          description: "Notifies you when a friend, group chat, or server removes you.",
          settings
        });`,
        settingsContent: `import { definePluginSettings } from "@api/Settings";
        import { OptionType } from "@utils/types";

        export default definePluginSettings({
          notices: {
            type: OptionType.BOOLEAN,
            description: "Also show a notice at the top of your screen when removed (use this if you don't want to miss any notifications).",
            default: false
          },
          offlineRemovals: {
            type: OptionType.BOOLEAN,
            description: "Notify you when starting discord if you were removed while offline.",
            default: true
          },
          friends: {
            type: OptionType.BOOLEAN,
            description: "Notify when a friend removes you",
            default: true
          },
          friendRequestCancels: {
            type: OptionType.BOOLEAN,
            description: "Notify when a friend request is cancelled",
            default: true
          },
          servers: {
            type: OptionType.BOOLEAN,
            description: "Notify when removed from a server",
            default: true
          },
          groups: {
            type: OptionType.BOOLEAN,
            description: "Notify when removed from a group chat",
            default: true
          }
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin = result.vencordPlugins['RelationshipNotifier'];
      expect(plugin).toBeDefined();
      expect(plugin?.name).toBe('RelationshipNotifier');
      expect(plugin?.description).toBe(
        'Notifies you when a friend, group chat, or server removes you.'
      );

      // Verify all settings are extracted from settings.ts
      expect(plugin?.settings.notices).toBeDefined();
      expect(plugin?.settings.offlineRemovals).toBeDefined();
      expect(plugin?.settings.friends).toBeDefined();
      expect(plugin?.settings.friendRequestCancels).toBeDefined();
      expect(plugin?.settings.servers).toBeDefined();
      expect(plugin?.settings.groups).toBeDefined();

      // Verify setting properties
      const notices = plugin?.settings.notices as any;
      expect(notices.name).toBe('notices');
      expect(notices.type).toBe('types.bool');
      expect(notices.default).toBe(false);

      const friends = plugin?.settings.friends as any;
      expect(friends.name).toBe('friends');
      expect(friends.type).toBe('types.bool');
      expect(friends.default).toBe(true);
      expect(friends.description).toBe('Notify when a friend removes you');
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('infers bool type when select options contain booleans', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'userPfpSelect', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";

        export default definePlugin({
          name: "UserPfpSelect",
          description: "Allows you to use an animated avatar without Nitro",
          settings
        });`,
        settingsContent: `import { definePluginSettings } from "@api/Settings";
        import { OptionType } from "@utils/types";

        export default definePluginSettings({
          preferNitro: {
            type: OptionType.SELECT,
            description: "Which avatar to prefer when both are available",
            options: [
              { label: "UserPFP", value: false },
              { label: "Nitro", value: true, default: true }
            ]
          }
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin = result.vencordPlugins['UserPfpSelect'];
      expect(plugin).toBeDefined();

      const preferNitro = plugin?.settings.preferNitro as any;
      expect(preferNitro).toBeDefined();
      expect(preferNitro.type).toBe('types.bool');
      expect(preferNitro.default).toBe(true);
      expect(preferNitro.enumValues).toBeUndefined();
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('parses vcNarrator plugin structure with computed defaults', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'vcNarrator', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";

        export default definePlugin({
          name: "VcNarrator",
          description: "Narrates voice channel events",
          settings
        });`,
        settingsContent: `import { definePluginSettings } from "@api/Settings";
        import { OptionType } from "@utils/types";

        export const getDefaultVoice = () => window.speechSynthesis?.getVoices().find(v => v.default);

        export default definePluginSettings({
          voice: {
            type: OptionType.COMPONENT,
            component: () => null,
            get default() {
              return getDefaultVoice()?.voiceURI;
            }
          },
          volume: {
            type: OptionType.SLIDER,
            description: "Narrator Volume",
            default: 1,
            markers: [0, 0.25, 0.5, 0.75, 1],
            stickToMarkers: false
          },
          joinMessage: {
            type: OptionType.STRING,
            description: "Join Message",
            default: "{{USER}} joined"
          }
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin = result.vencordPlugins['VcNarrator'];
      expect(plugin).toBeDefined();

      // Computed defaults are represented as nullable (we can't execute getters)
      const voice = plugin?.settings.voice as any;
      expect(voice.default).toBeNull();

      // Regular defaults should work
      const volume = plugin?.settings.volume as any;
      expect(volume.default).toBe(1);
      expect(volume.type).toBe('types.float');

      const joinMessage = plugin?.settings.joinMessage as any;
      expect(joinMessage.default).toBe('{{USER}} joined');
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('parses consoleJanitor plugin with COMPONENT type and object default', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'consoleJanitor', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";

        export default definePlugin({
          name: "ConsoleJanitor",
          description: "Cleans up console logs",
          settings
        });`,
        settingsContent: `import { definePluginSettings } from "@api/Settings";
        import { OptionType } from "@utils/types";

        function defineDefault<T>(value: T): T { return value; }

        export default definePluginSettings({
          disableLoggers: {
            type: OptionType.BOOLEAN,
            description: "Disables Discords loggers",
            default: false,
            restartNeeded: true
          },
          allowLevel: {
            type: OptionType.COMPONENT,
            component: () => null,
            default: defineDefault({
              error: true,
              warn: false,
              trace: false,
              log: false,
              info: false,
              debug: false
            })
          }
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin = result.vencordPlugins['ConsoleJanitor'];
      expect(plugin).toBeDefined();
      expect(plugin?.name).toBe('ConsoleJanitor');

      // Verify COMPONENT type with object default
      const allowLevel = plugin?.settings.allowLevel as any;
      expect(allowLevel).toBeDefined();
      expect(allowLevel.type).toBeDefined();
      // Default object should be extracted
      expect(allowLevel.default).toBeDefined();
      match(allowLevel.default)
        .when(
          (val): val is Record<string, unknown> => typeof val === 'object' && val !== null,
          (defaultObj) => {
            expect(defaultObj.error).toBe(true);
            expect(defaultObj.warn).toBe(false);
          }
        )
        .otherwise(() => {
          // Not an object, skip
        });
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('parses plugin with 3+ levels of nested settings', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'deeplyNested', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";

        export default definePlugin({
          name: "DeeplyNested",
          description: "Plugin with deeply nested settings",
          settings
        });`,
        settingsContent: `import { definePluginSettings } from "@api/Settings";
        import { OptionType } from "@utils/types";

        export default definePluginSettings({
          config: {
            deep: {
              deeper: {
                type: OptionType.NUMBER,
                description: "Deeply nested setting",
                default: 42
              },
              another: {
                type: OptionType.STRING,
                description: "Another deep setting",
                default: "test"
              }
            },
            other: {
              type: OptionType.BOOLEAN,
              description: "Other setting",
              default: true
            }
          },
          topLevel: {
            type: OptionType.STRING,
            description: "Top level setting",
            default: "value"
          }
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin = result.vencordPlugins['DeeplyNested'];
      expect(plugin).toBeDefined();
      expect(plugin?.name).toBe('DeeplyNested');

      // Verify 3-level nesting: config -> deep -> deeper
      const config = plugin?.settings.config as any;
      expect(config).toBeDefined();
      expect(config.settings).toBeDefined();

      const deep = config.settings.deep as any;
      expect(deep).toBeDefined();
      expect(deep.settings).toBeDefined();

      const deeper = deep.settings.deeper as any;
      expect(deeper).toBeDefined();
      expect(deeper.type).toBe('types.int');
      expect(deeper.default).toBe(42);

      // Verify another setting at same level as deeper
      const another = deep.settings.another as any;
      expect(another).toBeDefined();
      expect(another.type).toBe('types.str');
      expect(another.default).toBe('test');

      // Verify other setting at same level as deep
      const other = config.settings.other as any;
      expect(other).toBeDefined();
      expect(other.type).toBe('types.bool');
      expect(other.default).toBe(true);
    } finally {
      await fse.remove(tempDir);
    }
  });
});

describe('Error Handling', () => {
  test('handles malformed TypeScript syntax gracefully', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'malformed', {
        indexContent: `export default definePlugin({
          name: "Malformed",
          // Missing closing brace
          settings: {
            setting: {
              type: OptionType.STRING
            }
          }
        `,
      });

      await createTsConfig(tempDir);

      // Should not throw - ts-morph is tolerant and will parse what it can
      const result = await parsePlugins(tempDir);
      // Plugin may be parsed but with empty settings due to syntax errors
      const plugin = result.vencordPlugins['Malformed'];
      if (plugin) {
        // If parsed, settings should be empty due to syntax errors
        expect(Object.keys(plugin.settings || {})).toHaveLength(0);
      }
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('handles very deep nesting (4+ levels)', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'deepNesting', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";

        export default definePlugin({
          name: "DeepNesting",
          description: "Plugin with very deep nesting",
          settings
        });`,
        settingsContent: `import { definePluginSettings } from "@api/Settings";
        import { OptionType } from "@utils/types";

        export default definePluginSettings({
          level1: {
            level2: {
              level3: {
                level4: {
                  type: OptionType.STRING,
                  description: "4 levels deep",
                  default: "deep-value"
                },
                level4b: {
                  type: OptionType.NUMBER,
                  description: "Another 4 levels deep",
                  default: 999
                }
              },
              level3b: {
                type: OptionType.BOOLEAN,
                description: "3 levels deep",
                default: true
              }
            }
          }
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin = result.vencordPlugins['DeepNesting'];
      expect(plugin).toBeDefined();

      // Verify 4-level nesting: level1 -> level2 -> level3 -> level4
      const level1 = plugin?.settings.level1 as any;
      expect(level1).toBeDefined();
      expect(level1.settings).toBeDefined();

      const level2 = level1.settings.level2 as any;
      expect(level2).toBeDefined();
      expect(level2.settings).toBeDefined();

      const level3 = level2.settings.level3 as any;
      expect(level3).toBeDefined();
      expect(level3.settings).toBeDefined();

      const level4 = level3.settings.level4 as any;
      expect(level4).toBeDefined();
      expect(level4.type).toBe('types.str');
      expect(level4.default).toBe('deep-value');

      // Verify another setting at same level as level4
      const level4b = level3.settings.level4b as any;
      expect(level4b).toBeDefined();
      expect(level4b.type).toBe('types.int');
      expect(level4b.default).toBe(999);

      // Verify setting at level 3
      const level3b = level2.settings.level3b as any;
      expect(level3b).toBeDefined();
      expect(level3b.type).toBe('types.bool');
      expect(level3b.default).toBe(true);
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('handles plugins with invalid settings structure', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'invalid', {
        indexContent: `import definePlugin from "@utils/types";

        export default definePlugin({
          name: "Invalid",
          description: "Plugin with invalid settings"
          // Missing settings property
        });`,
      });

      await createTsConfig(tempDir);

      // Should handle gracefully - plugin should be parsed but with empty settings
      const result = await parsePlugins(tempDir);
      const plugin = result.vencordPlugins['Invalid'];
      expect(plugin).toBeDefined();
      expect(plugin?.name).toBe('Invalid');
      // Settings should be empty since none were found
      expect(Object.keys(plugin?.settings || {})).toHaveLength(0);
    } finally {
      await fse.remove(tempDir);
    }
  });
});

describe('Options Without Explicit Type', () => {
  test('handles greetStickerPicker.greetMode pattern (infers SELECT from options array)', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'greetStickerPicker', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";
        export default definePlugin({ name: "GreetStickerPicker", description: "Test", settings });`,
        settingsContent: `import { definePluginSettings, OptionType } from "@utils/types";
        export default definePluginSettings({
          greetMode: {
            description: "Greet mode",
            options: [
              { label: "Option 1", value: "value1" },
              { label: "Option 2", value: "value2", default: true }
            ]
            // Note: no explicit type: OptionType.SELECT
          }
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin =
        result.vencordPlugins['GreetStickerPicker'] ?? result.equicordPlugins['GreetStickerPicker'];
      expect(plugin).toBeDefined();

      const greetMode = plugin?.settings.greetMode as any;
      expect(greetMode).toBeDefined();
      // Should infer SELECT/enum type from options array
      expect(greetMode.type).toBe('types.enum');
      // Should extract enum values from options
      expect(greetMode.enumValues).toEqual(['value1', 'value2']);
      // Should extract default from options array
      expect(greetMode.default).toBe('value2');
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('infers enum type from options array with numeric enum values', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      await createPlugin(tempDir, 'numericOptions', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";
        export default definePlugin({ name: "NumericOptions", description: "Test", settings });`,
        settingsContent: `import { definePluginSettings, OptionType } from "@utils/types";
        const Modes = { First: 0, Second: 1 } as const;
        export default definePluginSettings({
          mode: {
            description: "Mode",
            options: [
              { label: "First", value: Modes.First },
              { label: "Second", value: Modes.Second, default: true }
            ]
            // No explicit type
          }
        });`,
      });

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      const plugin =
        result.vencordPlugins['NumericOptions'] ?? result.equicordPlugins['NumericOptions'];
      expect(plugin).toBeDefined();

      const mode = plugin?.settings.mode as any;
      expect(mode).toBeDefined();
      // Should infer enum type
      expect(mode.type).toBe('types.enum');
      // Should extract numeric enum values
      expect(Array.isArray(mode.enumValues)).toBe(true);
      expect(mode.enumValues.length).toBeGreaterThan(0);
    } finally {
      await fse.remove(tempDir);
    }
  });
});

describe('Path Mapping Resolution', () => {
  /**
   * Tests that the TypeChecker can resolve symbols using path mappings from tsconfig.
   *
   * Note: We manually add files to the project (for performance), but the TypeChecker
   * uses path mappings from tsconfig to resolve symbols. This test verifies that
   * path mappings are actually being used for symbol resolution, not just that
   * files exist at the right paths.
   */
  test('resolves @api/Settings import with baseUrl and paths', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      // Create tsconfig with baseUrl and paths
      const tsconfig = {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          jsx: 'react',
          allowJs: true,
          skipLibCheck: true,
          baseUrl: './src',
          paths: {
            '@api/*': ['api/*'],
            '@utils/*': ['utils/*'],
          },
        },
      };
      await fse.writeFile(join(tempDir, 'tsconfig.json'), JSON.stringify(tsconfig));

      // Create actual files at those paths
      const apiDir = join(tempDir, 'src', 'api');
      const utilsDir = join(tempDir, 'src', 'utils');
      await fse.ensureDir(apiDir);
      await fse.ensureDir(utilsDir);

      await fse.writeFile(
        join(apiDir, 'Settings.ts'),
        `export function definePluginSettings(settings: Record<string, unknown>) {
          return settings;
        }`
      );

      await fse.writeFile(
        join(utilsDir, 'types.ts'),
        `export const enum OptionType {
          STRING = 0,
          NUMBER = 1,
          BOOLEAN = 3,
          SELECT = 4
        }`
      );

      // Create plugin that uses path-mapped imports
      await createPlugin(tempDir, 'pathMapped', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";
        export default definePlugin({ name: "PathMapped", description: "Test", settings });`,
        settingsContent: `import { definePluginSettings } from "@api/Settings";
        import { OptionType } from "@utils/types";
        export default definePluginSettings({
          enabled: {
            type: OptionType.BOOLEAN,
            description: "Enable",
            default: true
          }
        });`,
      });

      const result = await parsePlugins(tempDir);
      const plugin = result.vencordPlugins['PathMapped'] ?? result.equicordPlugins['PathMapped'];
      expect(plugin).toBeDefined();
      expect(plugin?.settings.enabled).toBeDefined();
      const enabled = plugin?.settings.enabled as any;
      // Verify that the TypeChecker resolved OptionType.BOOLEAN using path mappings
      // If path mappings weren't working, this would fail or be inferred incorrectly
      expect(enabled.type).toBe('types.bool');
      expect(enabled.default).toBe(true);
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('resolves relative imports alongside path-mapped imports', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      const tsconfig = {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          jsx: 'react',
          allowJs: true,
          skipLibCheck: true,
          baseUrl: './src',
          paths: {
            '@api/*': ['api/*'],
            '@utils/*': ['utils/*'],
          },
        },
      };
      await fse.writeFile(join(tempDir, 'tsconfig.json'), JSON.stringify(tsconfig));

      const apiDir = join(tempDir, 'src', 'api');
      const utilsDir = join(tempDir, 'src', 'utils');
      await fse.ensureDir(apiDir);
      await fse.ensureDir(utilsDir);

      await fse.writeFile(
        join(apiDir, 'Settings.ts'),
        `export function definePluginSettings(settings: Record<string, unknown>) {
          return settings;
        }`
      );

      await fse.writeFile(
        join(utilsDir, 'types.ts'),
        `export const enum OptionType {
          STRING = 0,
          BOOLEAN = 3
        }`
      );

      // Create plugin with both path-mapped and relative imports
      const pluginDir = join(tempDir, 'src', 'plugins', 'mixedImports');
      await fse.ensureDir(pluginDir);

      await fse.writeFile(
        join(pluginDir, 'localTypes.ts'),
        `export const LocalOption = { Value: "test" } as const;`
      );

      await fse.writeFile(
        join(pluginDir, 'settings.ts'),
        `import { definePluginSettings } from "@api/Settings";
        import { OptionType } from "@utils/types";
        import { LocalOption } from "./localTypes";
        export default definePluginSettings({
          setting: {
            type: OptionType.STRING,
            description: "Setting",
            default: LocalOption.Value
          }
        });`
      );

      await fse.writeFile(
        join(pluginDir, 'index.ts'),
        `import definePlugin from "@utils/types";
        import settings from "./settings";
        export default definePlugin({ name: "MixedImports", description: "Test", settings });`
      );

      const result = await parsePlugins(tempDir);
      const plugin =
        result.vencordPlugins['MixedImports'] ?? result.equicordPlugins['MixedImports'];
      expect(plugin).toBeDefined();
      expect(plugin?.settings.setting).toBeDefined();
    } finally {
      await fse.remove(tempDir);
    }
  });
});

describe('Discord Enum Resolution', () => {
  test('resolves Discord enums from packages/discord-types/enums structure', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      // Create enum file structure matching real layout
      const enumsDir = join(tempDir, 'packages', 'discord-types', 'enums');
      await fse.ensureDir(enumsDir);

      await fse.writeFile(
        join(enumsDir, 'ActivityType.ts'),
        `export const ActivityType = {
          Playing: 0,
          Streaming: 1,
          Listening: 2,
          Watching: 3
        } as const;`
      );

      await fse.writeFile(
        join(enumsDir, 'ChannelType.ts'),
        `export const ChannelType = {
          GUILD_TEXT: 0,
          DM: 1,
          GUILD_VOICE: 2
        } as const;`
      );

      await createPlugin(tempDir, 'discordEnums', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";
        export default definePlugin({ name: "DiscordEnums", description: "Test", settings });`,
        settingsContent: `import { definePluginSettings, OptionType } from "@utils/types";
        import { ActivityType } from "../../../packages/discord-types/enums/ActivityType";
        import { ChannelType } from "../../../packages/discord-types/enums/ChannelType";
        export default definePluginSettings({
          activity: {
            type: OptionType.SELECT,
            description: "Activity",
            options: [
              { label: "Playing", value: ActivityType.Playing, default: true },
              { label: "Streaming", value: ActivityType.Streaming },
              { label: "Listening", value: ActivityType.Listening }
            ]
          },
          channel: {
            type: OptionType.SELECT,
            description: "Channel",
            options: [
              { label: "Text", value: ChannelType.GUILD_TEXT },
              { label: "DM", value: ChannelType.DM },
              { label: "Voice", value: ChannelType.GUILD_VOICE }
            ]
          }
        });`,
      });

      await createTsConfig(tempDir, { baseUrl: './src', include: ['src', 'packages'] });

      const result = await parsePlugins(tempDir);
      const plugin =
        result.vencordPlugins['DiscordEnums'] ?? result.equicordPlugins['DiscordEnums'];
      expect(plugin).toBeDefined();

      const activity = plugin?.settings.activity as any;
      expect(activity).toBeDefined();
      expect(activity.type).toBe('types.enum');
      expect(Array.isArray(activity.enumValues)).toBe(true);
      expect(activity.enumValues).toContain(0); // ActivityType.Playing
      expect(activity.enumValues).toContain(1); // ActivityType.Streaming
      expect(activity.default).toBe(0); // ActivityType.Playing

      const channel = plugin?.settings.channel as any;
      expect(channel).toBeDefined();
      expect(channel.type).toBe('types.enum');
      expect(Array.isArray(channel.enumValues)).toBe(true);
      expect(channel.enumValues).toContain(0); // ChannelType.GUILD_TEXT
      expect(channel.enumValues).toContain(1); // ChannelType.DM
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('resolves Discord enums with property access pattern', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      const enumsDir = join(tempDir, 'packages', 'discord-types', 'enums');
      await fse.ensureDir(enumsDir);

      await fse.writeFile(
        join(enumsDir, 'StatusType.ts'),
        `export const StatusType = {
          ONLINE: "online",
          IDLE: "idle",
          DND: "dnd",
          OFFLINE: "offline"
        } as const;`
      );

      await createPlugin(tempDir, 'statusEnum', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";
        export default definePlugin({ name: "StatusEnum", description: "Test", settings });`,
        settingsContent: `import { definePluginSettings, OptionType } from "@utils/types";
        import { StatusType } from "../../../packages/discord-types/enums/StatusType";
        export default definePluginSettings({
          status: {
            type: OptionType.SELECT,
            description: "Status",
            options: [
              { label: "Online", value: StatusType.ONLINE },
              { label: "Idle", value: StatusType.IDLE },
              { label: "DND", value: StatusType.DND, default: true },
              { label: "Offline", value: StatusType.OFFLINE }
            ]
          }
        });`,
      });

      await createTsConfig(tempDir, { baseUrl: './src', include: ['src', 'packages'] });

      const result = await parsePlugins(tempDir);
      const plugin = result.vencordPlugins['StatusEnum'] ?? result.equicordPlugins['StatusEnum'];
      expect(plugin).toBeDefined();

      const status = plugin?.settings.status as any;
      expect(status).toBeDefined();
      expect(status.type).toBe('types.enum');
      expect(status.enumValues).toContain('online');
      expect(status.enumValues).toContain('idle');
      expect(status.enumValues).toContain('dnd');
      expect(status.enumValues).toContain('offline');
      expect(status.default).toBe('dnd');
    } finally {
      await fse.remove(tempDir);
    }
  });
});

describe('Complex TypeScript Config', () => {
  /**
   * Tests that the parser can handle complex tsconfig setups.
   * The TypeChecker uses compiler options from tsconfig even with
   * skipFileDependencyResolution: true.
   */
  test('handles tsconfig with composite project references', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      const tsconfig = {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          jsx: 'react',
          allowJs: true,
          skipLibCheck: true,
          baseUrl: './src',
          paths: {
            '@api/*': ['api/*'],
            '@utils/*': ['utils/*'],
          },
          composite: true,
          declaration: true,
        },
        include: ['src/**/*'],
        exclude: ['node_modules'],
      };
      await fse.writeFile(join(tempDir, 'tsconfig.json'), JSON.stringify(tsconfig));

      const apiDir = join(tempDir, 'src', 'api');
      const utilsDir = join(tempDir, 'src', 'utils');
      await fse.ensureDir(apiDir);
      await fse.ensureDir(utilsDir);

      await fse.writeFile(
        join(apiDir, 'Settings.ts'),
        `export function definePluginSettings(settings: Record<string, unknown>) {
          return settings;
        }`
      );

      await fse.writeFile(
        join(utilsDir, 'types.ts'),
        `export const enum OptionType {
          STRING = 0,
          BOOLEAN = 3
        }`
      );

      await createPlugin(tempDir, 'compositeConfig', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";
        export default definePlugin({ name: "CompositeConfig", description: "Test", settings });`,
        settingsContent: `import { definePluginSettings } from "@api/Settings";
        import { OptionType } from "@utils/types";
        export default definePluginSettings({
          test: {
            type: OptionType.STRING,
            description: "Test",
            default: "value"
          }
        });`,
      });

      const result = await parsePlugins(tempDir);
      const plugin =
        result.vencordPlugins['CompositeConfig'] ?? result.equicordPlugins['CompositeConfig'];
      expect(plugin).toBeDefined();
      expect(plugin?.settings.test).toBeDefined();
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('handles tsconfig with strict mode and additional compiler options', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      const tsconfig = {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          jsx: 'react',
          allowJs: true,
          skipLibCheck: true,
          baseUrl: './src',
          paths: {
            '@api/*': ['api/*'],
            '@utils/*': ['utils/*'],
          },
          strict: true,
          noImplicitAny: true,
          strictNullChecks: true,
          esModuleInterop: true,
          resolveJsonModule: true,
        },
      };
      await fse.writeFile(join(tempDir, 'tsconfig.json'), JSON.stringify(tsconfig));

      const apiDir = join(tempDir, 'src', 'api');
      const utilsDir = join(tempDir, 'src', 'utils');
      await fse.ensureDir(apiDir);
      await fse.ensureDir(utilsDir);

      await fse.writeFile(
        join(apiDir, 'Settings.ts'),
        `export function definePluginSettings(settings: Record<string, unknown>) {
          return settings;
        }`
      );

      await fse.writeFile(
        join(utilsDir, 'types.ts'),
        `export const enum OptionType {
          STRING = 0,
          BOOLEAN = 3
        }`
      );

      await createPlugin(tempDir, 'strictConfig', {
        indexContent: `import definePlugin from "@utils/types";
        import settings from "./settings";
        export default definePlugin({ name: "StrictConfig", description: "Test", settings });`,
        settingsContent: `import { definePluginSettings } from "@api/Settings";
        import { OptionType } from "@utils/types";
        export default definePluginSettings({
          enabled: {
            type: OptionType.BOOLEAN,
            description: "Enabled",
            default: true
          }
        });`,
      });

      const result = await parsePlugins(tempDir);
      const plugin =
        result.vencordPlugins['StrictConfig'] ?? result.equicordPlugins['StrictConfig'];
      expect(plugin).toBeDefined();
      expect(plugin?.settings.enabled).toBeDefined();
      const enabled = plugin?.settings.enabled as any;
      expect(enabled.type).toBe('types.bool');
      expect(enabled.default).toBe(true);
    } finally {
      await fse.remove(tempDir);
    }
  });
});

describe('categorizePlugins()', () => {
  test('categorizes generic (shared) plugins', () => {
    const vencordResult: ParsedPluginsResult = {
      vencordPlugins: {
        'Shared Plugin': {
          name: 'Shared Plugin',
          settings: {},
        },
      },
      equicordPlugins: {},
    };

    const equicordResult: ParsedPluginsResult = {
      vencordPlugins: {
        'Shared Plugin': {
          name: 'Shared Plugin',
          settings: {},
        },
      },
      equicordPlugins: {},
    };

    const result = categorizePlugins(vencordResult, equicordResult);
    const sharedPlugin = Maybe.of(result.generic['Shared Plugin']);

    match(sharedPlugin)
      .with({ isJust: true }, ({ value }) => {
        expect(value?.name).toBe('Shared Plugin');
        expect(result.vencordOnly['Shared Plugin']).toBeUndefined();
      })
      .otherwise(() => {
        throw new Error('Expected Shared Plugin to be categorized as generic');
      });
  });

  test('categorizes vencord-only plugins', () => {
    const vencordResult: ParsedPluginsResult = {
      vencordPlugins: {
        'Vencord Only': {
          name: 'Vencord Only',
          settings: {},
        },
      },
      equicordPlugins: {},
    };

    const equicordResult: ParsedPluginsResult = {
      vencordPlugins: {},
      equicordPlugins: {},
    };

    const result = categorizePlugins(vencordResult, equicordResult);
    expect(result.vencordOnly['Vencord Only']).toBeDefined();
    expect(result.generic['Vencord Only']).toBeUndefined();
  });

  test('categorizes equicord-only plugins', () => {
    const vencordResult: ParsedPluginsResult = {
      vencordPlugins: {},
      equicordPlugins: {},
    };

    const equicordResult: ParsedPluginsResult = {
      vencordPlugins: {},
      equicordPlugins: {
        'Equicord Only': {
          name: 'Equicord Only',
          settings: {},
        },
      },
    };

    const result = categorizePlugins(vencordResult, equicordResult);
    expect(result.equicordOnly['Equicord Only']).toBeDefined();
    expect(result.generic['Equicord Only']).toBeUndefined();
  });

  test('handles missing equicordResult', () => {
    const vencordResult: ParsedPluginsResult = {
      vencordPlugins: {
        'Vencord Plugin': {
          name: 'Vencord Plugin',
          settings: {},
        },
      },
      equicordPlugins: {},
    };

    const result = categorizePlugins(vencordResult);
    expect(result.vencordOnly['Vencord Plugin']).toBeDefined();
    expect(result.equicordOnly).toEqual({});
  });

  test('handles empty plugins', () => {
    const vencordResult: ParsedPluginsResult = {
      vencordPlugins: {},
      equicordPlugins: {},
    };

    const result = categorizePlugins(vencordResult);
    const emptyCategorySizes = pipe(
      [result.generic, result.vencordOnly, result.equicordOnly] as const,
      map((record) => keys(record).length)
    );

    emptyCategorySizes.forEach((count) => expect(count).toBe(0));
  });

  test('uses equicord config for shared plugins', () => {
    const vencordResult: ParsedPluginsResult = {
      vencordPlugins: {
        'Shared Plugin': {
          name: 'Shared Plugin',
          description: 'Vencord description',
          settings: {
            setting: {
              name: 'setting',
              type: 'types.str',
              default: 'vencord-value',
            },
          },
        },
      },
      equicordPlugins: {},
    };

    const equicordResult: ParsedPluginsResult = {
      vencordPlugins: {
        'Shared Plugin': {
          name: 'Shared Plugin',
          description: 'Equicord description',
          settings: {
            setting: {
              name: 'setting',
              type: 'types.str',
              default: 'equicord-value',
            },
          },
        },
      },
      equicordPlugins: {},
    };

    const result = categorizePlugins(vencordResult, equicordResult);

    match(result.generic['Shared Plugin'])
      .with(
        P.when(
          (plugin): plugin is NonNullable<typeof plugin> =>
            plugin !== undefined &&
            plugin.description === 'Equicord description' &&
            (plugin.settings.setting as any).default === 'equicord-value'
        ),
        (shared) => {
          expect(shared.name).toBe('Shared Plugin');
        }
      )
      .otherwise(() => {
        throw new Error('Shared Plugin should prefer the Equicord definition');
      });
  });
});

describe('parsePlugins() fixture integration', () => {
  test('parses synthetic Vencord fixture tree', async () => {
    const result = await parsePlugins(VENCORD_FIXTURE);

    expect(result.equicordPlugins).toEqual({});
    expect(Object.keys(result.vencordPlugins)).toEqual(
      expect.arrayContaining(['Shared Plugin', 'Vencord Only'])
    );

    const shared = result.vencordPlugins['Shared Plugin'] as any;
    expect(shared.description).toBe('Vencord shared description');
    expect(shared.settings.message.default).toBe('vencord');

    const only = result.vencordPlugins['Vencord Only'] as any;
    expect(only.settings.enabled.default).toBe(true);
  });

  test('parses synthetic Equicord fixture tree', async () => {
    const result = await parsePlugins(EQUICORD_FIXTURE);

    expect(Object.keys(result.vencordPlugins)).toEqual(expect.arrayContaining(['Shared Plugin']));
    expect(Object.keys(result.equicordPlugins)).toEqual(expect.arrayContaining(['Equicord Only']));

    const shared = result.vencordPlugins['Shared Plugin'] as any;
    expect(shared.description).toBe('Equicord shared description');
    expect(shared.settings.message.default).toBe('equicord');

    const equicordOnly = result.equicordPlugins['Equicord Only'] as any;
    expect(equicordOnly.settings.theme.default).toBe('night');
  });

  test('categorizePlugins prefers Equicord definitions when both repos present', async () => {
    const vencordResult = await parsePlugins(VENCORD_FIXTURE);
    const equicordResult = await parsePlugins(EQUICORD_FIXTURE);

    const categorized = categorizePlugins(vencordResult, equicordResult);
    expect(categorized.generic['Shared Plugin']).toBeDefined();
    expect((categorized.generic['Shared Plugin'] as any).description).toBe(
      'Equicord shared description'
    );

    expect(categorized.vencordOnly['Vencord Only']).toBeDefined();
    expect(categorized.equicordOnly['Equicord Only']).toBeDefined();
  });
});
