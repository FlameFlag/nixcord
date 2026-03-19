import { describe, test, expect } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { parsePlugins, categorizePlugins } from '../../src/index.js';
import type { ParsedPluginsResult, PluginSetting } from '@nixcord/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_ROOT = join(__dirname, '..', 'fixtures');
const VENCORD_FIXTURE = join(FIXTURES_ROOT, 'vencord');
const EQUICORD_FIXTURE = join(FIXTURES_ROOT, 'equicord');

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
    const sharedPlugin = result.generic['Shared Plugin'];

    if (sharedPlugin) {
      expect(sharedPlugin.name).toBe('Shared Plugin');
      expect(result.vencordOnly['Shared Plugin']).toBeUndefined();
    } else {
      throw new Error('Expected Shared Plugin to be categorized as generic');
    }
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
    const emptyCategorySizes = [result.generic, result.vencordOnly, result.equicordOnly].map(
      (record) => Object.keys(record).length
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

    const shared = result.generic['Shared Plugin'];
    if (
      shared !== undefined &&
      shared.description === 'Equicord description' &&
      (shared.settings.setting as PluginSetting).default === 'equicord-value'
    ) {
      expect(shared.name).toBe('Shared Plugin');
    } else {
      throw new Error('Shared Plugin should prefer the Equicord definition');
    }
  });
});

describe('parsePlugins() fixture integration', () => {
  test('parses synthetic Vencord fixture tree', async () => {
    const result = await parsePlugins(VENCORD_FIXTURE);

    expect(result.equicordPlugins).toEqual({});
    expect(Object.keys(result.vencordPlugins)).toEqual(
      expect.arrayContaining(['Shared Plugin', 'Vencord Only'])
    );

    const shared = result.vencordPlugins['Shared Plugin'];
    expect(shared!.description).toBe('Vencord shared description');
    expect((shared!.settings.message as PluginSetting).default).toBe('vencord');

    const only = result.vencordPlugins['Vencord Only'];
    expect((only!.settings.enabled as PluginSetting).default).toBe(true);
  });

  test('parses synthetic Equicord fixture tree', async () => {
    const result = await parsePlugins(EQUICORD_FIXTURE);

    expect(Object.keys(result.vencordPlugins)).toEqual(expect.arrayContaining(['Shared Plugin']));
    expect(Object.keys(result.equicordPlugins)).toEqual(expect.arrayContaining(['Equicord Only']));

    const shared = result.vencordPlugins['Shared Plugin'];
    expect(shared!.description).toBe('Equicord shared description');
    expect((shared!.settings.message as PluginSetting).default).toBe('equicord');

    const equicordOnly = result.equicordPlugins['Equicord Only'];
    expect((equicordOnly!.settings.theme as PluginSetting).default).toBe('night');
  });

  test('categorizePlugins prefers Equicord definitions when both repos present', async () => {
    const vencordResult = await parsePlugins(VENCORD_FIXTURE);
    const equicordResult = await parsePlugins(EQUICORD_FIXTURE);

    const categorized = categorizePlugins(vencordResult, equicordResult);
    expect(categorized.generic['Shared Plugin']).toBeDefined();
    expect(categorized.generic['Shared Plugin']!.description).toBe('Equicord shared description');

    expect(categorized.vencordOnly['Vencord Only']).toBeDefined();
    expect(categorized.equicordOnly['Equicord Only']).toBeDefined();
  });
});
