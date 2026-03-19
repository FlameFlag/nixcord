import { describe, test, expect } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import fse from 'fs-extra';
import { parsePlugins } from '../../src/index.js';
import type { PluginSetting, PluginConfig } from '@nixcord/shared';
import { createTsConfig, createPlugin } from '../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
      const notices = plugin?.settings.notices as PluginSetting;
      expect(notices.name).toBe('notices');
      expect(notices.type).toBe('types.bool');
      expect(notices.default).toBe(false);

      const friends = plugin?.settings.friends as PluginSetting;
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

      const preferNitro = plugin?.settings.preferNitro as PluginSetting;
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
      const voice = plugin?.settings.voice as PluginSetting;
      expect(voice.default).toBeNull();

      // Regular defaults should work
      const volume = plugin?.settings.volume as PluginSetting;
      expect(volume.default).toBe(1);
      expect(volume.type).toBe('types.float');

      const joinMessage = plugin?.settings.joinMessage as PluginSetting;
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
      const allowLevel = plugin?.settings.allowLevel as PluginSetting;
      expect(allowLevel).toBeDefined();
      expect(allowLevel.type).toBeDefined();
      // Default object should be extracted
      expect(allowLevel.default).toBeDefined();
      if (typeof allowLevel.default === 'object' && allowLevel.default !== null) {
        const defaultObj = allowLevel.default as Record<string, unknown>;
        expect(defaultObj.error).toBe(true);
        expect(defaultObj.warn).toBe(false);
      }
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
      const config = plugin?.settings.config as PluginConfig;
      expect(config).toBeDefined();
      expect(config.settings).toBeDefined();

      const deep = config.settings.deep as PluginConfig;
      expect(deep).toBeDefined();
      expect(deep.settings).toBeDefined();

      const deeper = deep.settings.deeper as PluginSetting;
      expect(deeper).toBeDefined();
      expect(deeper.type).toBe('types.int');
      expect(deeper.default).toBe(42);

      // Verify another setting at same level as deeper
      const another = deep.settings.another as PluginSetting;
      expect(another).toBeDefined();
      expect(another.type).toBe('types.str');
      expect(another.default).toBe('test');

      // Verify other setting at same level as deep
      const other = config.settings.other as PluginSetting;
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
      const level1 = plugin?.settings.level1 as PluginConfig;
      expect(level1).toBeDefined();
      expect(level1.settings).toBeDefined();

      const level2 = level1.settings.level2 as PluginConfig;
      expect(level2).toBeDefined();
      expect(level2.settings).toBeDefined();

      const level3 = level2.settings.level3 as PluginConfig;
      expect(level3).toBeDefined();
      expect(level3.settings).toBeDefined();

      const level4 = level3.settings.level4 as PluginSetting;
      expect(level4).toBeDefined();
      expect(level4.type).toBe('types.str');
      expect(level4.default).toBe('deep-value');

      // Verify another setting at same level as level4
      const level4b = level3.settings.level4b as PluginSetting;
      expect(level4b).toBeDefined();
      expect(level4b.type).toBe('types.int');
      expect(level4b.default).toBe(999);

      // Verify setting at level 3
      const level3b = level2.settings.level3b as PluginSetting;
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

      const greetMode = plugin?.settings.greetMode as PluginSetting;
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

      const mode = plugin?.settings.mode as PluginSetting;
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
