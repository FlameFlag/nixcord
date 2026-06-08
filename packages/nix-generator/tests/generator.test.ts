import type { PluginConfig, PluginSetting, ReadonlyDeep } from '@nixcord/shared';
import { describe, expect, test } from 'vitest';
import { generatePluginJson, generatePluginModule, generateSettingJson } from '../src/generator.js';

describe('generateSettingJson()', () => {
  test('regular setting -> includes type', () => {
    const setting: PluginSetting = {
      name: 'message',
      type: 'types.str',
      description: 'Message to display',
      default: 'Hello',
    };
    const result = generateSettingJson(setting);
    expect(result.type).toBe('types.str');
    expect(result.default).toBe('Hello');
    expect(result.description).toBe('Message to display');
  });

  test('boolean type with default', () => {
    const setting: PluginSetting = {
      name: 'enabled',
      type: 'types.bool',
      description: 'Enable feature',
      default: true,
    };
    const result = generateSettingJson(setting);
    expect(result.type).toBe('types.bool');
    expect(result.default).toBe(true);
  });

  test('string type with default', () => {
    const setting: PluginSetting = {
      name: 'message',
      type: 'types.str',
      description: 'Message',
      default: 'Hello World',
    };
    const result = generateSettingJson(setting);
    expect(result.type).toBe('types.str');
    expect(result.default).toBe('Hello World');
  });

  test('integer type with default', () => {
    const setting: PluginSetting = {
      name: 'count',
      type: 'types.int',
      description: 'Count',
      default: 42,
    };
    const result = generateSettingJson(setting);
    expect(result.type).toBe('types.int');
    expect(result.default).toBe(42);
  });

  test('float type with default', () => {
    const setting: PluginSetting = {
      name: 'ratio',
      type: 'types.float',
      description: 'Ratio',
      default: 3.14,
    };
    const result = generateSettingJson(setting);
    expect(result.type).toBe('types.float');
    expect(result.default).toBe(3.14);
  });

  test('float type with integer default emits __nixRaw', () => {
    const setting: PluginSetting = {
      name: 'pitch',
      type: 'types.float',
      description: 'Pitch',
      default: 1,
    };
    const result = generateSettingJson(setting);
    expect(result.type).toBe('types.float');
    expect(result.default).toEqual({ __nixRaw: '1.0' });
  });

  test('int type with BigInt-like default string emits __nixRaw', () => {
    const setting: PluginSetting = {
      name: 'emojiId',
      type: 'types.int',
      description: 'Emoji ID',
      default: '1026532993923293184',
    };
    const result = generateSettingJson(setting);
    expect(result.type).toBe('types.int');
    expect(result.default).toEqual({ __nixRaw: '1026532993923293184' });
  });

  test('enum type with enumValues', () => {
    const setting: PluginSetting = {
      name: 'choice',
      type: 'types.enum',
      description: 'Choose option',
      enumValues: ['option1', 'option2'],
    };
    const result = generateSettingJson(setting);
    expect(result.type).toBe('types.enum');
    expect(result.enumValues).toEqual(['option1', 'option2']);
  });

  test('enum type with enumLabels generates Values: description', () => {
    const setting: PluginSetting = {
      name: 'choice',
      type: 'types.enum',
      description: 'Choose option',
      enumValues: [0, 1, 2],
      enumLabels: {
        0: 'Option Zero',
        1: 'Option One',
        2: 'Option Two',
      },
    };
    const result = generateSettingJson(setting);
    expect(result.type).toBe('types.enum');
    expect(result.description).toContain('Values: 0 = Option Zero, 1 = Option One, 2 = Option Two');
  });

  test('enum type with non-string labels are filtered out', () => {
    const setting: PluginSetting = {
      name: 'choice',
      type: 'types.enum',
      description: 'Choose option',
      enumValues: [0, 1, 2],
      enumLabels: {
        0: 'Option Zero',
        1: {} as unknown as string,
        2: 'Option Two',
      },
    };
    const result = generateSettingJson(setting);
    expect(result.description).toContain('Values: 0 = Option Zero, 2 = Option Two');
    expect(result.description).not.toContain('[object Object]');
    expect(result.description).not.toContain('1 =');
  });

  test('enum type without enumValues', () => {
    const setting: PluginSetting = {
      name: 'choice',
      type: 'types.enum',
      description: 'Choose option',
    };
    const result = generateSettingJson(setting);
    expect(result.type).toBe('types.enum');
    expect(result.enumValues).toBeUndefined();
  });

  test('setting with description', () => {
    const setting: PluginSetting = {
      name: 'message',
      type: 'types.str',
      description: 'A description\nwith multiple lines',
    };
    const result = generateSettingJson(setting);
    expect(result.description).toBe('A description\nwith multiple lines');
  });

  test('setting without description', () => {
    const setting: PluginSetting = {
      name: 'message',
      type: 'types.str',
    };
    const result = generateSettingJson(setting);
    expect(result.description).toBeUndefined();
  });

  test('setting with example', () => {
    const setting: PluginSetting = {
      name: 'message',
      type: 'types.str',
      description: 'Message',
      example: 'example-value',
    };
    const result = generateSettingJson(setting);
    expect(result.example).toBe('example-value');
  });

  test('setting without default', () => {
    const setting: PluginSetting = {
      name: 'message',
      type: 'types.str',
      description: 'Message',
    };
    const result = generateSettingJson(setting);
    expect(result.default).toBeUndefined();
  });

  test('nullOr types.str with null default', () => {
    const setting: PluginSetting = {
      name: 'serverUrl',
      type: 'types.nullOr types.str',
      description: 'Server URL',
      default: null,
    };
    const result = generateSettingJson(setting);
    expect(result.type).toBe('types.nullOr types.str');
    expect(result.default).toBeNull();
  });

  test('nested default values (arrays)', () => {
    const setting: PluginSetting = {
      name: 'items',
      type: 'types.listOf types.str',
      description: 'Items',
      default: ['item1', 'item2'],
    };
    const result = generateSettingJson(setting);
    expect(result.default).toEqual(['item1', 'item2']);
  });

  test('nested default values (objects)', () => {
    const setting: PluginSetting = {
      name: 'config',
      type: 'types.attrs',
      description: 'Configuration',
      default: { key: 'value' },
    };
    const result = generateSettingJson(setting);
    expect(result.default).toEqual({ key: 'value' });
  });
});

describe('generatePluginJson()', () => {
  test('plugin with explicit enable setting (skipped in settings, auto-generated by Nix)', () => {
    const config: PluginConfig = {
      name: 'TestPlugin',
      description: 'Test plugin',
      settings: {
        enable: {
          name: 'enable',
          type: 'types.bool',
          description: 'Enable plugin',
          default: true,
        },
        message: {
          name: 'message',
          type: 'types.str',
          description: 'Message',
          default: 'test',
        },
      },
    };
    const result = generatePluginJson('TestPlugin', config);
    // enable is handled by Nix side, not in settings
    expect(result.settings.enable).toBeUndefined();
    expect(result.settings.message).toBeDefined();
    expect(result.description).toBe('Test plugin');
  });

  test('plugin without explicit enable has description for Nix auto-enable', () => {
    const config: PluginConfig = {
      name: 'TestPlugin',
      description: 'Test plugin',
      settings: {
        message: {
          name: 'message',
          type: 'types.str',
          description: 'Message',
          default: 'test',
        },
      },
    };
    const result = generatePluginJson('TestPlugin', config);
    expect(result.description).toBe('Test plugin');
    expect(result.settings.message).toBeDefined();
  });

  test('plugin with category label -> includes category in description', () => {
    const config: PluginConfig = {
      name: 'TestPlugin',
      description: 'Test plugin',
      settings: {},
    };
    const result = generatePluginJson('TestPlugin', config, 'shared');
    expect(result.description).toContain('Test plugin');
    expect(result.description).toContain('(Shared between Vencord and Equicord)');
  });

  test('plugin with vencord category -> includes vencord label', () => {
    const config: PluginConfig = {
      name: 'TestPlugin',
      description: 'Test plugin',
      settings: {},
    };
    const result = generatePluginJson('TestPlugin', config, 'vencord');
    expect(result.description).toContain('(Vencord-only)');
  });

  test('plugin with equicord category -> includes equicord label', () => {
    const config: PluginConfig = {
      name: 'TestPlugin',
      description: 'Test plugin',
      settings: {},
    };
    const result = generatePluginJson('TestPlugin', config, 'equicord');
    expect(result.description).toContain('(Equicord-only)');
  });

  test('plugin with nested settings', () => {
    const config: PluginConfig = {
      name: 'TestPlugin',
      settings: {
        config: {
          name: 'config',
          settings: {
            nested: {
              name: 'nested',
              type: 'types.str',
              description: 'Nested setting',
              default: 'value',
            },
          },
        },
      },
    };
    const result = generatePluginJson('TestPlugin', config);
    expect(result.settings.config).toBeDefined();
    const nestedConfig = result.settings.config as { settings: Record<string, unknown> };
    expect(nestedConfig.settings.nested).toBeDefined();
  });

  test('plugin with simple settings only', () => {
    const config: PluginConfig = {
      name: 'TestPlugin',
      settings: {
        setting1: {
          name: 'setting1',
          type: 'types.str',
          description: 'Setting 1',
        },
        setting2: {
          name: 'setting2',
          type: 'types.int',
          description: 'Setting 2',
        },
      },
    };
    const result = generatePluginJson('TestPlugin', config);
    expect(result.settings.setting1).toBeDefined();
    expect(result.settings.setting2).toBeDefined();
  });

  test('plugin with empty settings', () => {
    const config: PluginConfig = {
      name: 'TestPlugin',
      description: 'Test plugin',
      settings: {},
    };
    const result = generatePluginJson('TestPlugin', config);
    expect(result.description).toBe('Test plugin');
    expect(Object.keys(result.settings)).toHaveLength(0);
  });
});

describe('generatePluginModule()', () => {
  test('generates valid JSON', () => {
    const plugins: ReadonlyDeep<Record<string, PluginConfig>> = {
      PluginA: {
        name: 'PluginA',
        settings: {},
      },
    };
    const result = generatePluginModule(plugins);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  test('ends generated JSON with a newline', () => {
    const result = generatePluginModule({});
    expect(result.endsWith('\n')).toBe(true);
  });

  test('sorts plugins alphabetically', () => {
    const plugins: ReadonlyDeep<Record<string, PluginConfig>> = {
      ZuluPlugin: {
        name: 'ZuluPlugin',
        settings: {},
      },
      AlphaPlugin: {
        name: 'AlphaPlugin',
        settings: {},
      },
      BetaPlugin: {
        name: 'BetaPlugin',
        settings: {},
      },
    };
    const result = generatePluginModule(plugins);
    const parsed = JSON.parse(result);
    const keys = Object.keys(parsed);
    expect(keys).toEqual(['alphaPlugin', 'betaPlugin', 'zuluPlugin']);
  });

  test('handles empty plugins record', () => {
    const plugins: ReadonlyDeep<Record<string, PluginConfig>> = {};
    const result = generatePluginModule(plugins);
    expect(JSON.parse(result)).toEqual({});
  });

  test('handles single plugin', () => {
    const plugins: ReadonlyDeep<Record<string, PluginConfig>> = {
      SinglePlugin: {
        name: 'SinglePlugin',
        description: 'A single plugin',
        settings: {},
      },
    };
    const result = generatePluginModule(plugins);
    const parsed = JSON.parse(result);
    expect(parsed.singlePlugin).toBeDefined();
    expect(parsed.singlePlugin.description).toBe('A single plugin');
  });

  test('handles multiple plugins', () => {
    const plugins: ReadonlyDeep<Record<string, PluginConfig>> = {
      Plugin1: {
        name: 'Plugin1',
        settings: {},
      },
      Plugin2: {
        name: 'Plugin2',
        settings: {},
      },
      Plugin3: {
        name: 'Plugin3',
        settings: {},
      },
    };
    const result = generatePluginModule(plugins);
    const parsed = JSON.parse(result);
    expect(parsed.plugin1).toBeDefined();
    expect(parsed.plugin2).toBeDefined();
    expect(parsed.plugin3).toBeDefined();
  });

  test('uses identifier conversion for plugin names', () => {
    const plugins: ReadonlyDeep<Record<string, PluginConfig>> = {
      'test-plugin': {
        name: 'test-plugin',
        settings: {},
      },
    };
    const result = generatePluginModule(plugins);
    const parsed = JSON.parse(result);
    expect(parsed.testPlugin).toBeDefined();
  });

  test('uses acronym-aware identifiers for plugin and setting names', () => {
    const plugins: ReadonlyDeep<Record<string, PluginConfig>> = {
      ClearURLs: {
        name: 'ClearURLs',
        settings: {
          BadgeAPI: {
            name: 'BadgeAPI',
            type: 'types.bool',
            description: 'Show API badge',
            default: false,
          },
        },
      },
    };

    const result = generatePluginModule(plugins);
    const parsed = JSON.parse(result);

    expect(parsed.clearUrls).toBeDefined();
    expect(parsed.ClearURLs).toBeUndefined();
    expect(parsed.clearUrls.settings.badgeApi).toBeDefined();
    expect(parsed.clearUrls.settings.BadgeAPI).toBeUndefined();
  });
});
