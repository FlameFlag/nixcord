import type { PluginConfig, ReadonlyDeep } from '@nixcord/shared';
import { isNestedConfig, sortedEntries } from '@nixcord/shared';
import { toNixIdentifier } from './identifier.js';

const baseUpperNames = [
  'usrbg',
  'webhook',
  'owner',
  'administrator',
  'moderatorStaff',
  'moderator',
  'voiceModerator',
  'chatModerator',
  'skipHostUpdate',
  'dangerousEnableDevtoolsOnlyEnableIfYouKnowWhatYoureDoing',
  'minWidth',
  'minHeight',
  'isMaximized',
  'isMinimized',
  'windowBounds',
  'openOnStartup',
  'minimizeToTray',
] as const;

const baseLowerPluginTitles: readonly string[] = [];

type PluginCollections = ReadonlyArray<ReadonlyDeep<Record<string, PluginConfig>>>;

function collectLowerPluginTitles(...collections: PluginCollections): string[] {
  const entriesList = collections.flatMap((collection) => Object.entries(collection));
  const lowerNames = entriesList
    .filter(([, config]) => {
      const name = config.name?.trim();
      if (!name) return false;
      const firstChar = name.slice(0, 1);
      return firstChar.toLowerCase() === firstChar;
    })
    .map(([slug]) => slug);
  return [...new Set([...baseLowerPluginTitles, ...lowerNames])].sort();
}

function collectSettingRenames(
  ...collections: PluginCollections
): Record<string, Record<string, string>> {
  const renames: Record<string, Record<string, string>> = {};

  const collectFromConfig = (parentNixName: string, config: ReadonlyDeep<PluginConfig>): void => {
    for (const setting of Object.values(config.settings)) {
      const nixName = toNixIdentifier(setting.name);
      if (nixName !== setting.name) {
        renames[parentNixName] ??= {};
        renames[parentNixName][nixName] = setting.name;
      }
      if (isNestedConfig(setting)) {
        const nestedNixName = toNixIdentifier(setting.name);
        collectFromConfig(nestedNixName, setting as ReadonlyDeep<PluginConfig>);
      }
    }
  };

  for (const collection of collections) {
    for (const [pluginSlug, config] of Object.entries(collection)) {
      collectFromConfig(toNixIdentifier(pluginSlug), config);
    }
  }

  return Object.fromEntries(
    sortedEntries(renames).map(([pluginName, settings]) => [
      pluginName,
      Object.fromEntries(sortedEntries(settings)),
    ])
  );
}

export function generateParseRulesModule(
  shared: ReadonlyDeep<Record<string, PluginConfig>>,
  vencordOnly: ReadonlyDeep<Record<string, PluginConfig>>,
  equicordOnly: ReadonlyDeep<Record<string, PluginConfig>>
): string {
  const lowerPluginTitles = collectLowerPluginTitles(shared, vencordOnly, equicordOnly);
  const settingRenames = collectSettingRenames(shared, vencordOnly, equicordOnly);

  return JSON.stringify(
    {
      lowerPluginTitles,
      settingRenames,
      upperNames: [...baseUpperNames],
    },
    null,
    2
  );
}
