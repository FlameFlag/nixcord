import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginSetting } from '@nixcord/shared';
import fse from 'fs-extra';
import { describe, expect, test } from 'vitest';
import { parsePlugins } from '../../src/index.js';
import { createPlugin, createTsConfig } from '../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
      const enabled = plugin?.settings.enabled as PluginSetting;
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

      const activity = plugin?.settings.activity as PluginSetting;
      expect(activity).toBeDefined();
      expect(activity.type).toBe('types.enum');
      expect(Array.isArray(activity.enumValues)).toBe(true);
      expect(activity.enumValues).toContain(0); // ActivityType.Playing
      expect(activity.enumValues).toContain(1); // ActivityType.Streaming
      expect(activity.default).toBe(0); // ActivityType.Playing

      const channel = plugin?.settings.channel as PluginSetting;
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

      const status = plugin?.settings.status as PluginSetting;
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
      const enabled = plugin?.settings.enabled as PluginSetting;
      expect(enabled.type).toBe('types.bool');
      expect(enabled.default).toBe(true);
    } finally {
      await fse.remove(tempDir);
    }
  });
});
