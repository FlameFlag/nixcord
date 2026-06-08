import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { DeprecatedData, PluginConfig, ReadonlyDeep } from '@nixcord/shared';
import fse from 'fs-extra';
import { join } from 'pathe';
import { describe, expect, test } from 'vitest';
import { updateDeprecatedPlugins } from '../src/deprecated.js';
import { toNixIdentifier } from '../src/identifier.js';
import { generateMigrationsData, generateMigrationsJson } from '../src/migrations-generator.js';

const mkPlugin = (description = ''): ReadonlyDeep<PluginConfig> => ({
  name: 'TestPlugin',
  description,
  settings: {},
  source: 'vencord' as const,
});

describe('generateMigrationsData()', () => {
  test('emits removal names for the Nix adapter', () => {
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

    const result = generateMigrationsData(deprecated, allPlugins);

    expect(result.removals).toEqual(['absRPC', 'betterArea']);
    expect(result.renames).toEqual([]);
  });

  test('empty migrations produce empty JSON arrays', () => {
    const deprecated: DeprecatedData = {
      renames: {},
      removals: {},
      settingRenames: {},
    };
    const allPlugins: Record<string, ReadonlyDeep<PluginConfig>> = {};

    const result = generateMigrationsData(deprecated, allPlugins);

    expect(result).toEqual({ renames: [], identifierRenames: [], removals: [] });
  });

  test('setting rename aliases are warning migrations', () => {
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

    const result = generateMigrationsData(deprecated, allPlugins);

    expect(result).toEqual({
      renames: [
        {
          from: ['testPlugin', 'oldSetting'],
          to: ['testPlugin', 'newSetting'],
          warn: true,
        },
      ],
      identifierRenames: [],
      removals: [],
    });
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

    const result = generateMigrationsData(deprecated, allPlugins);

    expect(result.renames).toEqual([
      {
        from: ['oldPlugin', 'enable'],
        to: ['newPlugin', 'enable'],
        warn: false,
      },
      {
        from: ['oldPlugin', 'format'],
        to: ['newPlugin', 'format'],
        warn: false,
      },
    ]);
  });

  test('can emit renames and removals together', () => {
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

    const result = generateMigrationsData(deprecated, allPlugins);

    expect(result).toEqual({
      renames: [
        {
          from: ['testPlugin', 'oldSetting'],
          to: ['testPlugin', 'newSetting'],
          warn: true,
        },
      ],
      identifierRenames: [],
      removals: ['deadPlugin'],
    });
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

    const result = generateMigrationsData(deprecated, allPlugins);

    expect(result.removals).toEqual([]);
    expect(result.renames).toEqual([]);
    expect(result.identifierRenames).toEqual([]);
  });

  test('serializes formatted JSON', () => {
    const deprecated: DeprecatedData = {
      renames: {},
      removals: {
        deadPlugin: { date: '2024-01-01' },
      },
      settingRenames: {},
    };
    const allPlugins: Record<string, ReadonlyDeep<PluginConfig>> = {};

    const result = generateMigrationsJson(deprecated, allPlugins);

    expect(result).toBe(
      '{\n  "renames": [],\n  "identifierRenames": [],\n  "removals": [\n    "deadPlugin"\n  ]\n}\n'
    );
  });

  test('emits warning aliases from legacy acronym identifiers to canonical identifiers', () => {
    const deprecated: DeprecatedData = {
      renames: {},
      removals: {},
      settingRenames: {},
    };
    const allPlugins: Record<string, ReadonlyDeep<PluginConfig>> = {
      ClearURLs: {
        ...mkPlugin('clear urls'),
        settings: {
          BadgeAPI: {
            name: 'BadgeAPI',
            type: 'types.bool',
            description: '',
            default: false,
          },
        },
      },
    };

    const result = generateMigrationsData(deprecated, allPlugins);

    expect(result.identifierRenames).toEqual([
      {
        from: ['ClearURLs', 'BadgeAPI'],
        to: ['clearUrls', 'badgeApi'],
        warn: true,
      },
      {
        from: ['ClearURLs', 'enable'],
        to: ['clearUrls', 'enable'],
        warn: true,
      },
    ]);
  });
});

describe('updateDeprecatedPlugins()', () => {
  test('canonicalizes rename targets to active plugin option names', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nixcord-deprecated-'));
    try {
      await fse.writeJson(join(tempDir, 'deprecated.json'), {
        renames: {
          PronounDB: { to: 'UserMessagesPronouns', date: '2999-01-01' },
        },
        removals: {},
        settingRenames: {},
      });

      const result = await updateDeprecatedPlugins(
        { renames: [], deletions: [] },
        tempDir,
        false,
        { info: () => {}, warn: () => {}, error: () => {}, success: () => {}, debug: () => {} },
        [],
        new Set(['userMessagesPronouns']),
        (name) => name.charAt(0).toLowerCase() + name.slice(1)
      );

      expect(result.renames.PronounDB?.to).toBe('userMessagesPronouns');
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('drops renames that canonicalize to the same active plugin option', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nixcord-deprecated-'));
    try {
      await fse.writeJson(join(tempDir, 'deprecated.json'), {
        renames: {
          petpet: { to: 'PetPet', date: '2999-01-01' },
        },
        removals: {},
        settingRenames: {},
      });

      const result = await updateDeprecatedPlugins(
        { renames: [], deletions: [] },
        tempDir,
        false,
        { info: () => {}, warn: () => {}, error: () => {}, success: () => {}, debug: () => {} },
        [],
        new Set(['petpet']),
        toNixIdentifier
      );

      expect(result.renames).toEqual({});
    } finally {
      await fse.remove(tempDir);
    }
  });
});
