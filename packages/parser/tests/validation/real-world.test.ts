import { existsSync } from 'node:fs';
import type { PluginSetting } from '@nixcord/shared';
import { describe, expect, test } from 'vitest';
import { categorizePlugins, parsePlugins } from '../../src/index.js';

const VENCORD_PATH = '/tmp/vencord';
const EQUICORD_PATH = '/tmp/equicord';
const hasVencord = existsSync(VENCORD_PATH);
const hasEquicord = existsSync(EQUICORD_PATH);

describe.skipIf(!hasVencord)('Real-world: Vencord', () => {
  test('parses Vencord plugins without throwing', async () => {
    const result = await parsePlugins(VENCORD_PATH);
    const pluginCount = Object.keys(result.vencordPlugins).length;

    expect(pluginCount).toBeGreaterThan(50);
    console.log(`Vencord: parsed ${pluginCount} plugins`);

    let withSettings = 0;
    let totalSettings = 0;
    for (const plugin of Object.values(result.vencordPlugins)) {
      const settingCount = Object.keys(plugin.settings).length;
      if (settingCount > 0) withSettings++;
      totalSettings += settingCount;
    }

    console.log(
      `Vencord: ${withSettings}/${pluginCount} plugins have settings (${totalSettings} total settings)`
    );
    expect(withSettings).toBeGreaterThan(10);
  }, 60_000);

  test('known plugins have expected structure', async () => {
    const result = await parsePlugins(VENCORD_PATH);
    const plugins = result.vencordPlugins;

    // SpotifyControls is a well-known Vencord plugin with settings
    if (plugins['SpotifyControls']) {
      expect(plugins['SpotifyControls'].settings).toBeDefined();
    }

    // Verify no plugin has undefined name
    for (const [name, plugin] of Object.entries(plugins)) {
      expect(name).toBeTruthy();
      expect(plugin.settings).toBeDefined();
    }
  }, 60_000);
});

describe.skipIf(!hasEquicord)('Real-world: Equicord', () => {
  test('parses Equicord plugins without throwing', async () => {
    const result = await parsePlugins(EQUICORD_PATH);
    const vencordCount = Object.keys(result.vencordPlugins).length;
    const equicordCount = Object.keys(result.equicordPlugins).length;
    const totalCount = vencordCount + equicordCount;

    expect(totalCount).toBeGreaterThan(100);
    console.log(
      `Equicord: parsed ${totalCount} plugins (${vencordCount} vencord + ${equicordCount} equicord)`
    );

    let withSettings = 0;
    let totalSettings = 0;
    for (const plugin of [
      ...Object.values(result.vencordPlugins),
      ...Object.values(result.equicordPlugins),
    ]) {
      const settingCount = Object.keys(plugin.settings).length;
      if (settingCount > 0) withSettings++;
      totalSettings += settingCount;
    }

    console.log(
      `Equicord: ${withSettings}/${totalCount} plugins have settings (${totalSettings} total settings)`
    );
    expect(withSettings).toBeGreaterThan(20);
  }, 60_000);
});

describe.skipIf(!hasVencord || !hasEquicord)('Real-world: categorize', () => {
  test('categorizes plugins from both repos', async () => {
    const vencordResult = await parsePlugins(VENCORD_PATH);
    const equicordResult = await parsePlugins(EQUICORD_PATH);
    const categorized = categorizePlugins(vencordResult, equicordResult);

    const genericCount = Object.keys(categorized.generic).length;
    const vencordOnlyCount = Object.keys(categorized.vencordOnly).length;
    const equicordOnlyCount = Object.keys(categorized.equicordOnly).length;

    console.log(
      `Categorized: ${genericCount} generic, ${vencordOnlyCount} vencord-only, ${equicordOnlyCount} equicord-only`
    );

    expect(genericCount).toBeGreaterThan(0);
    expect(vencordOnlyCount + equicordOnlyCount).toBeGreaterThan(0);
  }, 120_000);

  test('settings have valid types', async () => {
    const result = await parsePlugins(VENCORD_PATH);
    const validTypes = new Set([
      'types.str',
      'types.bool',
      'types.int',
      'types.float',
      'types.attrs',
      'types.nullOr types.str',
      'types.listOf types.str',
    ]);

    let validCount = 0;
    let enumCount = 0;
    let totalCount = 0;

    for (const plugin of Object.values(result.vencordPlugins)) {
      for (const setting of Object.values(plugin.settings)) {
        if ('type' in setting) {
          totalCount++;
          const s = setting as PluginSetting;
          if (validTypes.has(s.type)) {
            validCount++;
          } else if (s.type.startsWith('types.enum')) {
            enumCount++;
          }
        }
      }
    }

    console.log(
      `Setting types: ${validCount} standard, ${enumCount} enum, ${totalCount - validCount - enumCount} other (total: ${totalCount})`
    );
    expect(validCount + enumCount).toBeGreaterThan(totalCount * 0.8);
  }, 60_000);
});
