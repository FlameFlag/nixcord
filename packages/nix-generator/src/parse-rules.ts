import type { ReadonlyDeep } from 'type-fest';
import type { PluginConfig } from '@nixcord/shared';
import { AUTO_GENERATED_HEADER } from '@nixcord/shared';
import { NixGenerator } from './generator-base.js';

const gen = new NixGenerator();

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

export function generateParseRulesModule(
  shared: ReadonlyDeep<Record<string, PluginConfig>>,
  vencordOnly: ReadonlyDeep<Record<string, PluginConfig>>,
  equicordOnly: ReadonlyDeep<Record<string, PluginConfig>>
): string {
  const lowerPluginTitles = collectLowerPluginTitles(shared, vencordOnly, equicordOnly);

  const output = gen.attrSet({
    upperNames: [...baseUpperNames],
    lowerPluginTitles,
  });

  return [...AUTO_GENERATED_HEADER.split('\n'), '', output].join('\n');
}
