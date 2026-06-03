import type { PluginMigrationInfo } from '@nixcord/git-analyzer';
import type { DeprecatedData, DeprecatedRenameEntry, Logger, SettingRename } from '@nixcord/shared';
import { REMOVAL_EXPIRY_DAYS, RENAME_EXPIRY_DAYS, sortedEntries } from '@nixcord/shared';
import fse from 'fs-extra';
import { join } from 'pathe';

/** Plugin names must be valid Nix identifiers (no dots or other special chars). */
function isValidPluginName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

function isExpired(dateStr: string, expiryDays: number): boolean {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays > expiryDays;
}

/**
 * Read and parse deprecated.json.
 */
async function readDeprecatedJson(filePath: string): Promise<DeprecatedData> {
  const empty: DeprecatedData = { renames: {}, removals: {}, settingRenames: {} };
  try {
    const raw = await fse.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as {
      renames?: Record<string, unknown>;
      removals?: Record<string, unknown>;
      settingRenames?: Record<string, Record<string, string>>;
    };
    const data: DeprecatedData = { renames: {}, removals: {}, settingRenames: {} };

    for (const [name, val] of Object.entries(parsed.renames ?? {})) {
      const v = val as { to?: string; date?: string };
      if (v.to && isValidPluginName(name) && isValidPluginName(v.to)) {
        data.renames[name] = { to: v.to, ...(v.date ? { date: v.date } : {}) };
      }
    }
    for (const [name, val] of Object.entries(parsed.removals ?? {})) {
      const v = val as { date?: string };
      if (v.date && isValidPluginName(name)) {
        data.removals[name] = { date: v.date };
      }
    }
    for (const [pluginName, settings] of Object.entries(parsed.settingRenames ?? {})) {
      if (typeof settings === 'object' && settings !== null) {
        data.settingRenames[pluginName] = settings;
      }
    }

    return data;
  } catch {
    return empty;
  }
}

export function generateDeprecatedJson(data: DeprecatedData): string {
  const output: {
    renames: Record<string, { to: string; date?: string }>;
    removals: Record<string, { date: string }>;
    settingRenames: Record<string, Record<string, string>>;
  } = {
    renames: {},
    removals: {},
    settingRenames: {},
  };

  // Renames: permanent first, then dated (sorted)
  for (const [name, entry] of sortedEntries(data.renames).filter(([, v]) => !v.date)) {
    output.renames[name] = { to: entry.to };
  }
  for (const [name, entry] of sortedEntries(data.renames).filter(([, v]) => v.date)) {
    output.renames[name] = { to: entry.to, date: entry.date! };
  }

  // Removals (sorted)
  for (const [name, entry] of sortedEntries(data.removals)) {
    output.removals[name] = { date: entry.date };
  }

  // Setting renames (sorted)
  for (const [pluginName, settings] of sortedEntries(data.settingRenames)) {
    output.settingRenames[pluginName] = Object.fromEntries(sortedEntries(settings));
  }

  return `${JSON.stringify(output, null, 2)}\n`;
}

/**
 * Remove circular rename pairs (A -> B and B -> A both present).
 * These arise from ping-pong renames in git history and cancel each other out.
 */
function removeCircularRenames(renames: Record<string, DeprecatedRenameEntry>): void {
  const toRemove = new Set<string>();
  for (const [from, entry] of Object.entries(renames)) {
    if (toRemove.has(from)) continue;
    const to = entry.to;
    if (renames[to]?.to === from) {
      toRemove.add(from);
      toRemove.add(to);
    }
  }
  for (const name of toRemove) {
    delete renames[name];
  }
}

function removeSelfRenames(
  renames: Record<string, DeprecatedRenameEntry>,
  normalize: (name: string) => string
): void {
  for (const [from, entry] of Object.entries(renames)) {
    if (normalize(from) === normalize(entry.to)) {
      delete renames[from];
    }
  }
}

export async function updateDeprecatedPlugins(
  migrations: PluginMigrationInfo,
  pluginsDir: string,
  verbose: boolean,
  logger: Logger,
  settingRenames: SettingRename[] = [],
  activePluginNames?: Set<string>,
  normalizePluginName?: (name: string) => string
): Promise<DeprecatedData> {
  const deprecatedPath = join(pluginsDir, 'deprecated.json');
  const existing: DeprecatedData = (await fse.pathExists(deprecatedPath))
    ? await readDeprecatedJson(deprecatedPath)
    : { renames: {}, removals: {}, settingRenames: {} };
  const normalize = normalizePluginName ?? ((n: string) => n);

  // Merge new renames (skip dot-named plugins, don't overwrite existing entries)
  for (const rename of migrations.renames) {
    if (!isValidPluginName(rename.oldName) || !isValidPluginName(rename.newName)) continue;
    const dateStr = rename.commitDate.split('T')[0];
    if (!existing.renames[rename.oldName]) {
      existing.renames[rename.oldName] = { to: rename.newName, date: dateStr };
    }
  }

  // Merge new deletions (skip dot-named plugins)
  for (const deletion of migrations.deletions) {
    if (!isValidPluginName(deletion.pluginName)) continue;
    const dateStr = deletion.commitDate.split('T')[0];
    if (!existing.removals[deletion.pluginName]) {
      existing.removals[deletion.pluginName] = { date: dateStr };
    }
  }

  // Remove circular rename pairs (ping-pong renames that cancel each other out)
  removeCircularRenames(existing.renames);

  if (activePluginNames && normalizePluginName) {
    const activeNameByNormalizedName = new Map(
      [...activePluginNames].map((name) => [normalize(name), name])
    );
    const activeNameByLowercaseName = new Map(
      [...activePluginNames].map((name) => [name.toLowerCase(), name])
    );
    for (const entry of Object.values(existing.renames)) {
      entry.to =
        activeNameByNormalizedName.get(normalize(entry.to)) ??
        activeNameByLowercaseName.get(entry.to.toLowerCase()) ??
        entry.to;
    }
  }
  removeSelfRenames(existing.renames, normalize);

  // Remove permanent (dateless) renames - they predate the date system and are well past expiry
  for (const [name, entry] of Object.entries(existing.renames)) {
    if (!entry.date) {
      delete existing.renames[name];
    }
  }

  // Prune expired dated entries
  for (const [name, entry] of Object.entries(existing.renames)) {
    if (entry.date && isExpired(entry.date, RENAME_EXPIRY_DAYS)) {
      delete existing.renames[name];
    }
  }
  for (const [name, entry] of Object.entries(existing.removals)) {
    if (isExpired(entry.date, REMOVAL_EXPIRY_DAYS)) {
      delete existing.removals[name];
    }
  }

  // Don't include removals for plugins that are also in renames (they were renamed, not deleted)
  // Use case-insensitive comparison since git may report different casings for the same plugin
  const renameKeysLower = new Map(Object.keys(existing.renames).map((k) => [k.toLowerCase(), k]));
  for (const name of Object.keys(existing.removals)) {
    if (existing.renames[name] || renameKeysLower.has(name.toLowerCase())) {
      delete existing.removals[name];
    }
  }

  // Remove removals for plugins that are still active (git may see a file move as a deletion)
  if (activePluginNames) {
    const normalizedActiveNames = new Set([...activePluginNames].map(normalize));
    for (const name of Object.keys(existing.removals)) {
      if (normalizedActiveNames.has(normalize(name))) {
        delete existing.removals[name];
      }
    }
  }

  // Merge setting renames from migratePluginSetting() calls
  for (const rename of settingRenames) {
    const nixName = normalize(rename.pluginName);
    if (!existing.settingRenames[nixName]) {
      existing.settingRenames[nixName] = {};
    }
    existing.settingRenames[nixName][rename.oldSetting] = rename.newSetting;
  }

  // Deduplicate settingRenames by normalized name (e.g. "PlatformIndicators" -> "platformIndicators")
  {
    const deduped: Record<string, Record<string, string>> = {};
    for (const [key, settings] of Object.entries(existing.settingRenames)) {
      const nixKey = normalize(key);
      if (!deduped[nixKey]) {
        deduped[nixKey] = {};
      }
      Object.assign(deduped[nixKey], settings);
    }
    existing.settingRenames = deduped;
  }

  const json = generateDeprecatedJson(existing);
  await fse.writeFile(deprecatedPath, json);

  if (verbose) {
    const renameCount = Object.keys(existing.renames).length;
    const deletionCount = Object.keys(existing.removals).length;
    logger.info(`Updated deprecated.json: ${renameCount} renames, ${deletionCount} removals`);
  }

  return existing;
}
