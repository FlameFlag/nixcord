import type { ReadonlyDeep, PluginConfig, ParsedPluginsResult } from '@nixcord/shared';
import { filterNullish } from '@nixcord/shared';

const PLUGIN_RENAME_MAP: Record<string, string> = { oneko: 'CursorBuddy' };

export function categorizePlugins(
  vencordResult: Readonly<ParsedPluginsResult>,
  equicordResult?: Readonly<ParsedPluginsResult>
): {
  readonly generic: ReadonlyDeep<Record<string, PluginConfig>>;
  readonly vencordOnly: ReadonlyDeep<Record<string, PluginConfig>>;
  readonly equicordOnly: ReadonlyDeep<Record<string, PluginConfig>>;
} {
  const vencordPlugins = vencordResult.vencordPlugins;
  const equicordSharedPlugins = equicordResult?.vencordPlugins ?? {};
  const equicordOnlyPlugins = equicordResult?.equicordPlugins ?? {};

  const equicordDirectoryMap = Object.entries(equicordSharedPlugins)
    .filter(([, config]) => config.directoryName !== undefined)
    .reduce((acc, [name, config]) => {
      acc.set(config.directoryName!.toLowerCase(), name);
      return acc;
    }, new Map<string, string>());

  const pluginMatches = Object.entries(vencordPlugins).map(([name, config]) => {
    const getEquicordConfig = (): PluginConfig | undefined => {
      const existing = equicordSharedPlugins[name];
      if (existing) return existing;

      const renamedPlugin = PLUGIN_RENAME_MAP[name];
      if (renamedPlugin) {
        return equicordOnlyPlugins[renamedPlugin] || equicordSharedPlugins[renamedPlugin];
      }

      const dirName = config?.directoryName;
      if (typeof dirName === 'string') {
        const equicordName = equicordDirectoryMap.get(dirName.toLowerCase());
        if (equicordName) {
          return equicordSharedPlugins[equicordName];
        }
      }

      return undefined;
    };

    return { name, config, equicordConfig: getEquicordConfig() };
  });

  const genericMatches = pluginMatches.filter(
    ({ equicordConfig }) => equicordConfig !== undefined && !equicordConfig.isModified
  );
  const vencordMatches = pluginMatches.filter(
    ({ equicordConfig }) => equicordConfig === undefined || equicordConfig.isModified
  );

  const genericTuples = genericMatches.map(
    ({ name, equicordConfig }) => [name, equicordConfig!] as [string, PluginConfig]
  );

  const vencordTuples = vencordMatches.map(
    ({ name, config }) => [name, config] as [string, PluginConfig]
  );

  const matchedEquicordPluginNames = new Set(
    genericMatches
      .map(({ equicordConfig }) => equicordConfig!.name)
      .filter((name) => name !== undefined)
  );

  const modifiedEquicordSharedPluginNames = new Set(
    vencordMatches
      .map(({ equicordConfig }) => equicordConfig?.name)
      .filter((name): name is string => name !== undefined)
  );

  const filteredEquicordOnly = Object.fromEntries(
    Object.entries(equicordOnlyPlugins).filter(
      ([name]) =>
        !matchedEquicordPluginNames.has(name) && !modifiedEquicordSharedPluginNames.has(name)
    )
  );

  const modifiedSharedPlugins = Object.fromEntries(
    Object.entries(equicordSharedPlugins).filter(([name]) =>
      modifiedEquicordSharedPluginNames.has(name)
    )
  );

  // Plugins that live in Equicord's `src/plugins` but have no Vencord counterpart
  // would otherwise be silently dropped because the categorizer only iterates
  // Vencord's plugin list above.
  const renamedEquicordTargets = new Set(Object.values(PLUGIN_RENAME_MAP));
  const equicordSharedExtras = Object.fromEntries(
    Object.entries(equicordSharedPlugins).filter(
      ([name]) =>
        vencordPlugins[name] === undefined &&
        !matchedEquicordPluginNames.has(name) &&
        !modifiedEquicordSharedPluginNames.has(name) &&
        !renamedEquicordTargets.has(name)
    )
  );

  return {
    generic: filterNullish(Object.fromEntries(genericTuples)) as ReadonlyDeep<
      Record<string, PluginConfig>
    >,
    vencordOnly: filterNullish(Object.fromEntries(vencordTuples)) as ReadonlyDeep<
      Record<string, PluginConfig>
    >,
    equicordOnly: filterNullish({
      ...filteredEquicordOnly,
      ...modifiedSharedPlugins,
      ...equicordSharedExtras,
    }) as ReadonlyDeep<Record<string, PluginConfig>>,
  };
}
