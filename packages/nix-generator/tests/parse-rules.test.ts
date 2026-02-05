import { describe, test, expect } from 'vitest';
import type { ReadonlyDeep } from 'type-fest';
import type { PluginConfig } from '@nixcord/shared';
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

  test('includes auto-detected lowercase plugin names', () => {
    const output = generateParseRulesModule(shared, vencordOnly, equicordOnly);
    expect(output).toContain('iLoveSpam');
    expect(output).toContain('petpet');
    expect(output).not.toContain('showConnections');
  });

  test('always includes static upper-name entries', () => {
    const output = generateParseRulesModule({}, {}, {});
    expect(output).toContain('webhook');
    expect(output).toContain('owner');
  });
});
