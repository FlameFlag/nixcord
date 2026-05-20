import type { DeprecatedData, PluginConfig, ReadonlyDeep } from '@nixcord/shared';
import { isNestedConfig, sortedEntries } from '@nixcord/shared';
import { toNixIdentifier } from './identifier.js';

export interface MigrationRenameJson {
  from: string[];
  to: string[];
  warn: boolean;
}

export interface MigrationsJson {
  renames: MigrationRenameJson[];
  removals: string[];
}

/**
 * Collect all leaf setting names from a plugin config (flattened).
 * Always includes "enable".
 */
function normalizeSettingPath(path: string): string {
  return path.split('.').map(toNixIdentifier).join('.');
}

function normalizePathParts(path: string): string[] {
  return normalizeSettingPath(path).split('.');
}

function collectSettingNames(config: ReadonlyDeep<PluginConfig>): string[] {
  const names = new Set<string>();
  names.add('enable');

  for (const [key, setting] of Object.entries(config.settings)) {
    const settingName = toNixIdentifier(
      'name' in setting && typeof setting.name === 'string' ? setting.name : key
    );
    if (isNestedConfig(setting)) {
      for (const nestedName of collectSettingNames(setting)) {
        names.add(`${settingName}.${nestedName}`);
      }
    } else {
      names.add(settingName);
    }
  }

  return Array.from(names);
}

function mkRenameEntry(
  oldPlugin: string,
  newPlugin: string,
  fromSettingPath: string,
  toSettingPath = fromSettingPath,
  warn = false
): MigrationRenameJson {
  const oldId = toNixIdentifier(oldPlugin);
  const newId = toNixIdentifier(newPlugin);

  // Plugin options commonly have defaults. Warning aliases can therefore fire
  // during evaluation even when users never referenced the obsolete option.
  return {
    from: [oldId, ...normalizePathParts(fromSettingPath)],
    to: [newId, ...normalizePathParts(toSettingPath)],
    warn,
  };
}

export function generateMigrationsData(
  deprecated: DeprecatedData,
  allPlugins: ReadonlyDeep<Record<string, PluginConfig>>,
  pluginSources?: ReadonlyDeep<Record<string, PluginConfig>>[]
): MigrationsJson {
  // Build lookup of active plugin nix identifiers to skip conflicting migrations
  const activeNixNames = new Set(Object.keys(allPlugins).map((k) => toNixIdentifier(k)));

  // Pre-filter setting rename entries, deduplicating by Nix identifier
  // Multiple source names (e.g. "platformIndicators" and "PlatformIndicators")
  // can map to the same Nix identifier, so we merge their settings.
  const settingRenamesByNixName = new Map<string, Record<string, string>>();
  for (const [pluginName, settings] of sortedEntries(deprecated.settingRenames ?? {})) {
    const nixName = toNixIdentifier(pluginName);
    if (!activeNixNames.has(nixName)) continue;
    const existing = settingRenamesByNixName.get(nixName) ?? {};
    Object.assign(existing, settings);
    settingRenamesByNixName.set(nixName, existing);
  }
  const settingRenameEntries = Array.from(settingRenamesByNixName.entries());

  const pluginsByNixName = new Map(
    Object.entries(allPlugins).map(([name, config]) => [toNixIdentifier(name), config])
  );

  // Pre-filter rename entries to the ones that still need compatibility aliases.
  const renameEntries = sortedEntries(deprecated.renames).filter(([oldName, entry]) => {
    const oldNixName = toNixIdentifier(oldName);
    const newNixName = toNixIdentifier(entry.to);
    return !activeNixNames.has(oldNixName) && activeNixNames.has(newNixName);
  });

  // Pre-compute removals while skipping plugin names that came back upstream.
  const removalEntries = sortedEntries(deprecated.removals).filter(
    ([pluginName]) => !activeNixNames.has(toNixIdentifier(pluginName))
  );
  const migrations: MigrationsJson = {
    renames: [],
    removals: removalEntries.map(([pluginName]) => toNixIdentifier(pluginName)),
  };

  for (const [oldName, entry] of renameEntries) {
    const newName = entry.to;

    const targetPlugin = pluginsByNixName.get(toNixIdentifier(newName));

    if (!targetPlugin) {
      // Target plugin not found in parsed data - just forward enable
      migrations.renames.push(mkRenameEntry(oldName, newName, 'enable'));
    } else {
      const settingNames = collectSettingNames(targetPlugin);
      for (const setting of settingNames.sort()) {
        migrations.renames.push(mkRenameEntry(oldName, newName, setting));
      }
    }
  }

  // Build a lookup from nix identifier to ALL setting names across all plugin versions.
  // A plugin may exist in both vencord and equicord with different settings;
  // we need the union of all settings to detect conflicts correctly.
  const allSettingsByNixName = new Map<string, Set<string>>();
  const sources = pluginSources ?? [allPlugins];
  for (const source of sources) {
    for (const [name, config] of Object.entries(source)) {
      const nixName = toNixIdentifier(name);
      const existing = allSettingsByNixName.get(nixName) ?? new Set<string>();
      for (const s of collectSettingNames(config)) {
        existing.add(s);
      }
      allSettingsByNixName.set(nixName, existing);
    }
  }

  // Generate setting rename migrations
  for (const [nixName, settings] of settingRenameEntries) {
    // Filter out renames where the old setting name still exists on the active plugin,
    // as mkRenamedOptionModule would conflict with the existing option declaration.
    const activeSettingNames = allSettingsByNixName.get(nixName) ?? new Set<string>();

    const validRenames = Object.entries(settings)
      .map(
        ([oldSetting, newSetting]) =>
          [normalizeSettingPath(oldSetting), normalizeSettingPath(newSetting)] as const
      )
      .filter(([oldSetting]) => !activeSettingNames.has(oldSetting))
      .sort(([a], [b]) => a.localeCompare(b));

    if (validRenames.length === 0) continue;

    for (const [oldSetting, newSetting] of validRenames) {
      migrations.renames.push(mkRenameEntry(nixName, nixName, oldSetting, newSetting, true));
    }
  }

  return migrations;
}

export function generateMigrationsJson(
  deprecated: DeprecatedData,
  allPlugins: ReadonlyDeep<Record<string, PluginConfig>>,
  pluginSources?: ReadonlyDeep<Record<string, PluginConfig>>[]
): string {
  return JSON.stringify(generateMigrationsData(deprecated, allPlugins, pluginSources), null, 2);
}
