import type { PluginConfig, ReadonlyDeep } from '@nixcord/shared';
import { describe, expect, test } from 'vitest';
import { generateParseRulesModule } from '../src/parse-rules.js';

describe('generateParseRulesModule()', () => {
  const shared: ReadonlyDeep<Record<string, PluginConfig>> = {
    showConnections: {
      name: 'ShowConnections',
      description: 'Show connected accounts',
      settings: {},
    },
  } as const;

  const vencordOnly: ReadonlyDeep<Record<string, PluginConfig>> = {
    iLoveSpam: {
      name: 'iLoveSpam',
      description: 'Keep spam visible',
      settings: {},
    },
  } as const;

  const equicordOnly: ReadonlyDeep<Record<string, PluginConfig>> = {
    petpet: {
      name: 'petpet',
      description: 'Pet pets',
      settings: {},
    },
  } as const;

  test('generates valid JSON', () => {
    const output = generateParseRulesModule(shared, vencordOnly, equicordOnly);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  test('ends generated JSON with a newline', () => {
    const output = generateParseRulesModule({}, {}, {});
    expect(output.endsWith('\n')).toBe(true);
  });

  test('includes auto-detected lowercase plugin names', () => {
    const output = generateParseRulesModule(shared, vencordOnly, equicordOnly);
    const parsed = JSON.parse(output);
    expect(parsed.lowerPluginTitles).toContain('iLoveSpam');
    expect(parsed.lowerPluginTitles).toContain('petpet');
    expect(parsed.lowerPluginTitles).not.toContain('showConnections');
  });

  test('includes plugin renames for generated JSON titles', () => {
    const output = generateParseRulesModule(
      {
        ClearURLs: {
          name: 'ClearURLs',
          description: 'Clear URLs',
          settings: {},
        },
      },
      {},
      {}
    );
    const parsed = JSON.parse(output);

    expect(parsed.pluginRenames.clearUrls).toBe('ClearURLs');
  });

  test('always includes static upper-name entries', () => {
    const output = generateParseRulesModule({}, {}, {});
    const parsed = JSON.parse(output);
    expect(parsed.upperNames).toContain('webhook');
    expect(parsed.upperNames).toContain('owner');
  });

  test('sorts setting rename rules deterministically', () => {
    const output = generateParseRulesModule(
      {},
      {
        zebraPlugin: {
          name: 'ZebraPlugin',
          description: 'Out of order plugin',
          settings: {
            betaSetting: {
              name: 'Beta Setting',
              description: 'Needs a rename',
              type: 'types.str',
              default: '',
            },
            alphaSetting: {
              name: 'Alpha Setting',
              description: 'Needs a rename',
              type: 'types.str',
              default: '',
            },
          },
        },
        alphaPlugin: {
          name: 'AlphaPlugin',
          description: 'First plugin',
          settings: {
            renamedSetting: {
              name: 'Renamed Setting',
              description: 'Needs a rename',
              type: 'types.str',
              default: '',
            },
          },
        },
      },
      {}
    );
    const parsed = JSON.parse(output);

    expect(Object.keys(parsed.settingRenames)).toEqual(['alphaPlugin', 'zebraPlugin']);
    expect(Object.keys(parsed.settingRenames.zebraPlugin)).toEqual(['alphaSetting', 'betaSetting']);
  });
});
