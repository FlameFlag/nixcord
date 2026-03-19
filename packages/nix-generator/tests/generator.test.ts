import { describe, test, expect } from 'vitest';
import type { ReadonlyDeep } from 'type-fest';
import { generateNixSetting, generateNixPlugin, generateNixModule } from '../src/generator.js';
import type { NixAttrSet } from '../src/generator-base.js';
import type { PluginSetting, PluginConfig } from '@nixcord/shared';

describe('generateNixSetting()', () => {
  test('enable setting -> mkEnableOption', () => {
    const setting: PluginSetting = {
      name: 'enable',
      type: 'types.bool',
      description: 'Enable the plugin',
      default: true,
    };
    const result = generateNixSetting(setting);
    expect(result.value).toContain('mkEnableOption');
    expect(result.value).toContain('Enable the plugin');
  });

  test('enable setting with category label -> includes category in description', () => {
    const setting: PluginSetting = {
      name: 'enable',
      type: 'types.bool',
      description: 'Enable the plugin',
      default: true,
    };
    const result = generateNixSetting(setting, 'shared');
    expect(result.value).toContain('mkEnableOption');
    expect(result.value).toContain('Enable the plugin');
    expect(result.value).toContain('(Shared between Vencord and Equicord)');
  });

  test('enable setting with vencord category -> includes vencord label', () => {
    const setting: PluginSetting = {
      name: 'enable',
      type: 'types.bool',
      description: 'Enable the plugin',
      default: true,
    };
    const result = generateNixSetting(setting, 'vencord');
    expect(result.value).toContain('(Vencord-only)');
  });

  test('enable setting with equicord category -> includes equicord label', () => {
    const setting: PluginSetting = {
      name: 'enable',
      type: 'types.bool',
      description: 'Enable the plugin',
      default: true,
    };
    const result = generateNixSetting(setting, 'equicord');
    expect(result.value).toContain('(Equicord-only)');
  });

  test('regular setting -> mkOption', () => {
    const setting: PluginSetting = {
      name: 'message',
      type: 'types.str',
      description: 'Message to display',
      default: 'Hello',
    };
    const result = generateNixSetting(setting);
    expect(result.value).toContain('mkOption');
    expect(result.value).not.toContain('mkEnableOption');
  });

  test('boolean type with default', () => {
    const setting: PluginSetting = {
      name: 'enabled',
      type: 'types.bool',
      description: 'Enable feature',
      default: true,
    };
    const result = generateNixSetting(setting);
    expect(result.value).toContain('types.bool');
    expect(result.value).toContain('default = true');
  });

  test('string type with default', () => {
    const setting: PluginSetting = {
      name: 'message',
      type: 'types.str',
      description: 'Message',
      default: 'Hello World',
    };
    const result = generateNixSetting(setting);
    expect(result.value).toContain('types.str');
    expect(result.value).toContain('default = "Hello World"');
  });

  test('integer type with default', () => {
    const setting: PluginSetting = {
      name: 'count',
      type: 'types.int',
      description: 'Count',
      default: 42,
    };
    const result = generateNixSetting(setting);
    expect(result.value).toContain('types.int');
    expect(result.value).toContain('default = 42');
  });

  test('float type with default', () => {
    const setting: PluginSetting = {
      name: 'ratio',
      type: 'types.float',
      description: 'Ratio',
      default: 3.14,
    };
    const result = generateNixSetting(setting);
    expect(result.value).toContain('types.float');
    expect(result.value).toContain('default = 3.14');
  });

  test('float type with integer default emits 1.0 style literal', () => {
    const setting: PluginSetting = {
      name: 'pitch',
      type: 'types.float',
      description: 'Pitch',
      default: 1,
    };
    const result = generateNixSetting(setting);
    expect(result.value).toContain('types.float');
    expect(result.value).toContain('default = 1.0');
  });

  test('int type with BigInt-like default string emits raw integer', () => {
    const setting: PluginSetting = {
      name: 'emojiId',
      type: 'types.int',
      description: 'Emoji ID',
      // The extractor converts BigInt literals to numeric strings (Nix doesn't have BigInt)
      // The generator should emit these as raw unquoted integers, not quoted strings
      default: '1026532993923293184',
    };
    const result = generateNixSetting(setting);
    expect(result.value).toContain('types.int');
    // Verify the default is emitted as a raw integer, not a quoted string
    expect(result.value).toContain('default = 1026532993923293184');
    expect(result.value).not.toContain('"1026532993923293184"');
  });

  test('enum type with enumValues', () => {
    const setting: PluginSetting = {
      name: 'choice',
      type: 'types.enum',
      description: 'Choose option',
      enumValues: ['option1', 'option2'],
    };
    const result = generateNixSetting(setting);
    expect(result.value).toContain('types.enum');
    expect(result.value).toContain('"option1"');
    expect(result.value).toContain('"option2"');
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
    const result = generateNixSetting(setting);
    expect(result.value).toContain('types.enum');
    expect(result.value).toContain('Values: 0 = Option Zero, 1 = Option One, 2 = Option Two');
    expect(result.value).not.toContain('[object Object]');
  });

  test('enum type with non-string labels are filtered out', () => {
    const setting: PluginSetting = {
      name: 'choice',
      type: 'types.enum',
      description: 'Choose option',
      enumValues: [0, 1, 2],
      enumLabels: {
        0: 'Option Zero',
        1: {} as unknown as string, // Non-string label should be ignored
        2: 'Option Two',
      },
    };
    const result = generateNixSetting(setting);
    expect(result.value).toContain('types.enum');
    expect(result.value).toContain('Values: 0 = Option Zero, 2 = Option Two');
    expect(result.value).not.toContain('[object Object]');
    expect(result.value).not.toContain('1 =');
  });

  test('enum type without enumValues', () => {
    const setting: PluginSetting = {
      name: 'choice',
      type: 'types.enum',
      description: 'Choose option',
    };
    const result = generateNixSetting(setting);
    expect(result.value).toContain('types.enum');
    // Even without enum values, we emit the enum type with an empty list
    // This ensures the setting appears in the generated Nix, even if incomplete
    expect(result.value).toContain('types.enum [');
  });

  test('setting with description', () => {
    const setting: PluginSetting = {
      name: 'message',
      type: 'types.str',
      description: 'A description\nwith multiple lines',
    };
    const result = generateNixSetting(setting);
    expect(result.value).toContain('description');
    expect(result.value).toContain('A description');
  });

  test('setting without description', () => {
    const setting: PluginSetting = {
      name: 'message',
      type: 'types.str',
    };
    const result = generateNixSetting(setting);
    expect(result.value).not.toContain('description');
  });

  test('setting with example', () => {
    const setting: PluginSetting = {
      name: 'message',
      type: 'types.str',
      description: 'Message',
      example: 'example-value',
    };
    const result = generateNixSetting(setting);
    expect(result.value).toContain('example');
    expect(result.value).toContain('example-value');
  });

  test('setting without default', () => {
    const setting: PluginSetting = {
      name: 'message',
      type: 'types.str',
      description: 'Message',
    };
    const result = generateNixSetting(setting);
    expect(result.value).not.toContain('default');
  });

  test('nullOr types.str with null default -> includes default = null', () => {
    const setting: PluginSetting = {
      name: 'serverUrl',
      type: 'types.nullOr types.str',
      description: 'Server URL',
      default: null,
    };
    const result = generateNixSetting(setting);
    expect(result.value).toContain('types.nullOr types.str');
    expect(result.value).toContain('default = null');
  });

  test('nullOr types.str with null default -> includes default = null (regression test)', () => {
    // Regression test: nullable string types must have explicit null defaults
    // The default-value-resolution module sets null defaults for nullable types,
    // but we test with null explicitly here to ensure the generator handles it correctly
    const setting: PluginSetting = {
      name: 'apiKey',
      type: 'types.nullOr types.str',
      description: 'API key',
      default: null,
    };
    const result = generateNixSetting(setting);
    expect(result.value).toContain('types.nullOr types.str');
    expect(result.value).toContain('default = null');
  });

  test('nested default values (arrays)', () => {
    const setting: PluginSetting = {
      name: 'items',
      type: 'types.listOf types.str',
      description: 'Items',
      default: ['item1', 'item2'],
    };
    const result = generateNixSetting(setting);
    expect(result.value).toContain('default');
    expect(result.value).toContain('[');
  });

  test('nested default values (objects)', () => {
    const setting: PluginSetting = {
      name: 'config',
      type: 'types.attrs',
      description: 'Configuration',
      default: { key: 'value' },
    };
    const result = generateNixSetting(setting);
    expect(result.value).toContain('default');
    expect(result.value).toContain('{');
  });
});

describe('generateNixPlugin()', () => {
  test('plugin with explicit enable setting', () => {
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
    const result = generateNixPlugin('TestPlugin', config);
    expect(result.enable).toBeDefined();
    expect(result.message).toBeDefined();
  });

  test('plugin without explicit enable (auto-generates)', () => {
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
    const result = generateNixPlugin('TestPlugin', config);
    expect(result.enable).toBeDefined();
    const enableValue = result.enable;
    if (typeof enableValue === 'object' && enableValue !== null && 'value' in enableValue) {
      expect((enableValue as { value: string }).value).toContain('mkEnableOption');
      expect((enableValue as { value: string }).value).toContain('Test plugin');
    }
  });

  test('plugin with description', () => {
    const config: PluginConfig = {
      name: 'TestPlugin',
      description: 'A test plugin',
      settings: {},
    };
    const result = generateNixPlugin('TestPlugin', config);
    const enableValue = result.enable;
    if (typeof enableValue === 'object' && enableValue !== null && 'value' in enableValue) {
      expect((enableValue as { value: string }).value).toContain('A test plugin');
    }
  });

  test('plugin without description', () => {
    const config: PluginConfig = {
      name: 'TestPlugin',
      settings: {},
    };
    const result = generateNixPlugin('TestPlugin', config);
    const enableValue = result.enable;
    if (typeof enableValue === 'object' && enableValue !== null && 'value' in enableValue) {
      expect((enableValue as { value: string }).value).toContain('""');
    }
  });

  test('plugin with category label -> includes category in auto-generated enable', () => {
    const config: PluginConfig = {
      name: 'TestPlugin',
      description: 'Test plugin',
      settings: {},
    };
    const result = generateNixPlugin('TestPlugin', config, 'shared');
    const enableValue = result.enable;
    if (typeof enableValue === 'object' && enableValue !== null && 'value' in enableValue) {
      expect((enableValue as { value: string }).value).toContain('Test plugin');
      expect((enableValue as { value: string }).value).toContain(
        '(Shared between Vencord and Equicord)'
      );
    }
  });

  test('plugin with explicit enable and category -> includes category in enable description', () => {
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
      },
    };
    const result = generateNixPlugin('TestPlugin', config, 'vencord');
    const enableValue = result.enable;
    if (typeof enableValue === 'object' && enableValue !== null && 'value' in enableValue) {
      expect((enableValue as { value: string }).value).toContain('Enable plugin');
      expect((enableValue as { value: string }).value).toContain('(Vencord-only)');
    }
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
    const result = generateNixPlugin('TestPlugin', config);
    expect(result.config).toBeDefined();
    const configValue = result.config as NixAttrSet;
    expect(configValue.nested).toBeDefined();
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
    const result = generateNixPlugin('TestPlugin', config);
    expect(result.setting1).toBeDefined();
    expect(result.setting2).toBeDefined();
  });

  test('plugin with empty settings', () => {
    const config: PluginConfig = {
      name: 'TestPlugin',
      description: 'Test plugin',
      settings: {},
    };
    const result = generateNixPlugin('TestPlugin', config);
    // Should still have enable
    expect(result.enable).toBeDefined();
  });
});

describe('generateNixModule()', () => {
  test('generates correct module structure', () => {
    const plugins: ReadonlyDeep<Record<string, PluginConfig>> = {
      PluginA: {
        name: 'PluginA',
        settings: {},
      },
    };
    const result = generateNixModule(plugins);
    expect(result).toContain('{ lib, ... }:');
    expect(result).toContain('let');
    expect(result).toContain('in');
  });

  test('includes inherit statement', () => {
    const plugins: ReadonlyDeep<Record<string, PluginConfig>> = {
      PluginA: {
        name: 'PluginA',
        settings: {},
      },
    };
    const result = generateNixModule(plugins);
    expect(result).toContain('inherit (lib)');
    expect(result).toContain('types');
    expect(result).toContain('mkEnableOption');
    expect(result).toContain('mkOption');
  });

  test('includes let block', () => {
    const plugins: ReadonlyDeep<Record<string, PluginConfig>> = {};
    const result = generateNixModule(plugins);
    expect(result).toContain('let');
  });

  test('includes in statement', () => {
    const plugins: ReadonlyDeep<Record<string, PluginConfig>> = {};
    const result = generateNixModule(plugins);
    expect(result).toContain('in');
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
    const result = generateNixModule(plugins);
    const alphaPos = result.indexOf('alphaPlugin');
    const betaPos = result.indexOf('betaPlugin');
    const zuluPos = result.indexOf('zuluPlugin');
    expect(alphaPos).toBeGreaterThan(-1);
    expect(betaPos).toBeGreaterThan(-1);
    expect(zuluPos).toBeGreaterThan(-1);
    expect(alphaPos).toBeLessThan(betaPos);
    expect(betaPos).toBeLessThan(zuluPos);
  });

  test('handles empty plugins record', () => {
    const plugins: ReadonlyDeep<Record<string, PluginConfig>> = {};
    const result = generateNixModule(plugins);
    expect(result).toContain('{ }');
  });

  test('handles single plugin', () => {
    const plugins: ReadonlyDeep<Record<string, PluginConfig>> = {
      SinglePlugin: {
        name: 'SinglePlugin',
        description: 'A single plugin',
        settings: {},
      },
    };
    const result = generateNixModule(plugins);
    expect(result).toContain('singlePlugin');
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
    const result = generateNixModule(plugins);
    expect(result).toContain('plugin1');
    expect(result).toContain('plugin2');
    expect(result).toContain('plugin3');
  });

  test('uses identifier conversion for plugin names', () => {
    const plugins: ReadonlyDeep<Record<string, PluginConfig>> = {
      'test-plugin': {
        name: 'test-plugin',
        settings: {},
      },
    };
    const result = generateNixModule(plugins);
    // Should convert to camelCase
    expect(result).toContain('testPlugin');
  });
});
