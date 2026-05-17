import { describe, test, expect } from 'vitest';
import { generateMigrationsModule } from '../src/migrations-generator.js';
import type { ReadonlyDeep, PluginConfig, DeprecatedData } from '@nixcord/shared';

const mkPlugin = (description = ''): ReadonlyDeep<PluginConfig> => ({
  name: 'TestPlugin',
  description,
  settings: {},
  source: 'vencord' as const,
});

describe('generateMigrationsModule()', () => {
  test('removal shims use mkRemovedPluginModule helper', () => {
    const deprecated: DeprecatedData = {
      renames: {},
      removals: {
        absRPC: { date: '2024-01-01' },
        betterArea: { date: '2024-01-01' },
      },
      settingRenames: {},
    };
    const allPlugins: Record<string, ReadonlyDeep<PluginConfig>> = {
      testPlugin: mkPlugin('A test plugin'),
    };

    const result = generateMigrationsModule(deprecated, allPlugins);

    expect(result).toContain(
      'mkRemovedPluginModule = import ../lib/mkRemovedPluginModule.nix { inherit lib; };'
    );
    expect(result).toContain('(mkRemovedPluginModule "absRPC")');
    expect(result).toContain('(mkRemovedPluginModule "betterArea")');
    // Should NOT contain inline module definitions
    expect(result).not.toContain('lib.types.anything');
    expect(result).not.toContain('config.warnings');
  });

  test('no let block when nothing to generate', () => {
    const deprecated: DeprecatedData = {
      renames: {},
      removals: {},
      settingRenames: {},
    };
    const allPlugins: Record<string, ReadonlyDeep<PluginConfig>> = {};

    const result = generateMigrationsModule(deprecated, allPlugins);

    expect(result).not.toContain('let');
    expect(result).not.toContain('mkRemovedPluginModule');
    expect(result).toContain('imports = [');
  });

  test('let block includes base when renames exist', () => {
    const deprecated: DeprecatedData = {
      renames: {},
      removals: {},
      settingRenames: {
        testPlugin: { oldSetting: 'newSetting' },
      },
    };
    const allPlugins: Record<string, ReadonlyDeep<PluginConfig>> = {
      testPlugin: mkPlugin('test'),
    };

    const result = generateMigrationsModule(deprecated, allPlugins);

    expect(result).toContain('base =');
    expect(result).not.toContain('mkRemovedPluginModule');
  });

  test('plugin rename aliases are silent for target defaults', () => {
    const deprecated: DeprecatedData = {
      renames: { OldPlugin: { to: 'NewPlugin', date: '2026-01-01' } },
      removals: {},
      settingRenames: {},
    };
    const allPlugins: Record<string, ReadonlyDeep<PluginConfig>> = {
      NewPlugin: {
        ...mkPlugin('new'),
        settings: {
          format: {
            name: 'format',
            type: 'types.str',
            description: '',
            default: 'compact',
          },
        },
      },
    };

    const result = generateMigrationsModule(deprecated, allPlugins);

    expect(result).toContain('lib.modules.doRename');
    expect(result).toContain('warn = false');
    expect(result).toContain('use = x: x');
    expect(result).not.toContain('mkRenamedOptionModule');
    expect(result).toContain('base ++ ["oldPlugin" "enable"]');
    expect(result).toContain('base ++ ["newPlugin" "enable"]');
    expect(result).toContain('base ++ ["oldPlugin" "format"]');
    expect(result).toContain('base ++ ["newPlugin" "format"]');
  });

  test('let block includes both base and helper when renames and removals exist', () => {
    const deprecated: DeprecatedData = {
      renames: {},
      removals: {
        deadPlugin: { date: '2024-01-01' },
      },
      settingRenames: {
        testPlugin: { oldSetting: 'newSetting' },
      },
    };
    const allPlugins: Record<string, ReadonlyDeep<PluginConfig>> = {
      testPlugin: mkPlugin('test'),
    };

    const result = generateMigrationsModule(deprecated, allPlugins);

    expect(result).toContain('base =');
    expect(result).toContain('mkRemovedPluginModule');
    expect(result).toContain('(mkRemovedPluginModule "deadPlugin")');
  });

  test('skips removal shims for plugins that are still active', () => {
    const deprecated: DeprecatedData = {
      renames: {},
      removals: {
        testPlugin: { date: '2024-01-01' },
      },
      settingRenames: {},
    };
    const allPlugins: Record<string, ReadonlyDeep<PluginConfig>> = {
      testPlugin: mkPlugin('still active'),
    };

    const result = generateMigrationsModule(deprecated, allPlugins);

    expect(result).not.toContain('mkRemovedPluginModule');
    expect(result).not.toContain('testPlugin');
  });
});
