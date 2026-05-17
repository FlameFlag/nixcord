import type { ReadonlyDeep, PluginConfig, DeprecatedData } from '@nixcord/shared';
import { AUTO_GENERATED_HEADER, isNestedConfig, sortedEntries } from '@nixcord/shared';
import { toNixIdentifier } from './identifier.js';

const BASE_PATH = '["programs" "nixcord" "config" "plugins"';

/**
 * Collect all leaf setting names from a plugin config (flattened).
 * Always includes "enable".
 */
function normalizeSettingPath(path: string): string {
  return path.split('.').map(toNixIdentifier).join('.');
}

function collectSettingNames(config: ReadonlyDeep<PluginConfig>): string[] {
  const names = new Set<string>();
  names.add('enable');

  for (const [, setting] of Object.entries(config.settings)) {
    const settingName = toNixIdentifier(setting.name);
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

/**
 * Generate a silent alias for a single renamed plugin setting path.
 */
function mkRenamedLine(oldPlugin: string, newPlugin: string, settingPath: string): string {
  const parts = normalizeSettingPath(settingPath).split('.');
  const oldParts = parts.map((p) => `"${p}"`).join(' ');
  const newParts = parts.map((p) => `"${p}"`).join(' ');
  const oldId = toNixIdentifier(oldPlugin);
  const newId = toNixIdentifier(newPlugin);
  const from = `base ++ ["${oldId}" ${oldParts}]`;
  const to = `base ++ ["${newId}" ${newParts}]`;

  // Plugin options commonly have defaults. Warning aliases can therefore fire
  // during evaluation even when users never referenced the obsolete option.
  return `    (lib.modules.doRename { from = ${from}; to = ${to}; visible = false; warn = false; use = x: x; })`;
}

/**
 * Generate a removal shim module for a deleted plugin,
 * using the shared mkRemovedPluginModule helper.
 */
function mkRemovalShim(pluginName: string): string {
  const nixName = toNixIdentifier(pluginName);
  return `    (mkRemovedPluginModule "${nixName}")`;
}

export function generateMigrationsModule(
  deprecated: DeprecatedData,
  allPlugins: ReadonlyDeep<Record<string, PluginConfig>>,
  pluginSources?: ReadonlyDeep<Record<string, PluginConfig>>[]
): string {
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

  // Pre-filter rename entries to know if we need the `let base` binding
  const renameEntries = sortedEntries(deprecated.renames).filter(([oldName, entry]) => {
    const oldNixName = toNixIdentifier(oldName);
    const newNixName = toNixIdentifier(entry.to);
    return !activeNixNames.has(oldNixName) && activeNixNames.has(newNixName);
  });

  const hasSettingRenames = settingRenameEntries.length > 0;
  const hasRenames = renameEntries.length > 0;

  // Pre-compute whether we have removals so we can emit the helper binding
  const removalEntries = sortedEntries(deprecated.removals).filter(
    ([pluginName]) => !activeNixNames.has(toNixIdentifier(pluginName))
  );
  const hasRemovals = removalEntries.length > 0;
  const needsLetBlock = hasRenames || hasSettingRenames || hasRemovals;

  const lines: string[] = [...AUTO_GENERATED_HEADER.split('\n'), ''];

  if (!needsLetBlock) {
    lines.push('');
  }
  if (needsLetBlock) {
    lines.push('{ lib, ... }:');
    lines.push('let');
    if (hasRenames || hasSettingRenames) {
      lines.push(`  base = ${BASE_PATH}];`);
    }
    if (hasRemovals) {
      lines.push(
        '  mkRemovedPluginModule = import ../lib/mkRemovedPluginModule.nix { inherit lib; };'
      );
    }
    lines.push('in');
  }

  lines.push('{', '  imports = [');

  for (const [oldName, entry] of renameEntries) {
    const newName = entry.to;

    const targetPlugin = allPlugins[newName];

    lines.push(`    # ${oldName} -> ${newName}`);

    if (!targetPlugin) {
      // Target plugin not found in parsed data - just forward enable
      lines.push(mkRenamedLine(oldName, newName, 'enable'));
    } else {
      const settingNames = collectSettingNames(targetPlugin);
      for (const setting of settingNames.sort()) {
        lines.push(mkRenamedLine(oldName, newName, setting));
      }
    }
    lines.push('');
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

    lines.push(`    # Setting renames: ${nixName}`);
    for (const [oldSetting, newSetting] of validRenames) {
      lines.push(
        `    (lib.modules.doRename { from = base ++ ["${nixName}" "${oldSetting}"]; to = base ++ ["${nixName}" "${newSetting}"]; visible = false; warn = true; use = x: x; })`
      );
    }
    lines.push('');
  }

  // Generate removal shims using the shared mkRemovedPluginModule helper
  for (const [pluginName] of removalEntries) {
    lines.push(`    # Removed: ${pluginName}`);
    lines.push(mkRemovalShim(pluginName));
    lines.push('');
  }

  lines.push('  ];');
  lines.push('}');

  return lines.join('\n') + '\n';
}
