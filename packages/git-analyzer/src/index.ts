// fallow-ignore-file code-duplication

import { REMOVAL_EXPIRY_DAYS, RENAME_EXPIRY_DAYS } from '@nixcord/shared';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const DAYS_TO_CHECK = 18;
const PLUGIN_FILE_PATTERN = /index\.(ts|tsx)$/;

export type DeprecationInfo = {
  plugin: string;
  setting: string;
  removed: boolean;
  commitDate: string;
  commitHash: string;
};

export type PluginRename = {
  oldName: string;
  newName: string;
  commitDate: string;
  commitHash: string;
};

export type PluginDeletion = {
  pluginName: string;
  commitDate: string;
  commitHash: string;
};

export type PluginMigrationInfo = {
  renames: PluginRename[];
  deletions: PluginDeletion[];
};

const hasGit = async (path: string): Promise<boolean> => {
  try {
    await execAsync('git rev-parse --git-dir', { cwd: path });
    return true;
  } catch {
    return false;
  }
};

const getRecentCommits = async (
  repoPath: string,
  days: number = DAYS_TO_CHECK
): Promise<Array<{ hash: string; date: string }>> => {
  const logResult = await execAsync(`git log --since="${days} days ago" --pretty=format:"%H|%cI"`, {
    cwd: repoPath,
  });
  if (!logResult.stdout.trim()) return [];

  return logResult.stdout
    .trim()
    .split('\n')
    .map((line) => {
      const parts = line.split('|');
      return { hash: parts[0], date: parts[1] };
    });
};

const getCommitFiles = async (repoPath: string, commitHash: string): Promise<string[]> => {
  const diffResult = await execAsync(`git diff-tree --name-only -r ${commitHash}`, {
    cwd: repoPath,
  });
  return diffResult.stdout.trim().split('\n').filter(Boolean);
};

const getRemovedSettings = async (
  repoPath: string,
  filePath: string,
  oldHash: string,
  newHash: string
): Promise<string[]> => {
  try {
    const diffResult = await execAsync(`git diff ${oldHash}..${newHash} -- "${filePath}"`, {
      cwd: repoPath,
    });
    return diffResult.stdout
      .split('\n')
      .filter((line) => line.startsWith('-') && !line.startsWith('---'))
      .map((line) => line.match(/["'](\w+)["']\s*:/)?.[1])
      .filter((match): match is string => match !== undefined);
  } catch {
    return [];
  }
};

/**
 * Extract plugin directory name from a file path like "src/plugins/foo/index.ts"
 * Returns the directory name (e.g. "foo") or null if the path doesn't match.
 */
const extractPluginDirName = (filePath: string, pluginsDirs: string[]): string | null => {
  for (const dir of pluginsDirs) {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`;
    if (filePath.startsWith(prefix) && PLUGIN_FILE_PATTERN.test(filePath)) {
      const rest = filePath.slice(prefix.length);
      const parts = rest.split('/');
      if (parts.length === 2) {
        return parts[0];
      }
    }
  }
  return null;
};

/**
 * Build glob patterns for git commands targeting plugin index files.
 */
const buildPluginGlobs = (pluginsDirs: string[]): string => {
  return pluginsDirs.flatMap((dir) => [`"${dir}/*/index.ts"`, `"${dir}/*/index.tsx"`]).join(' ');
};

export const extractPluginRenames = async (
  repoPath: string,
  pluginsDirs: string[],
  days: number = RENAME_EXPIRY_DAYS
): Promise<PluginRename[]> => {
  if (!(await hasGit(repoPath))) return [];

  const globs = buildPluginGlobs(pluginsDirs);
  try {
    const renameResult = await execAsync(
      `git log --since="${days} days ago" -M --diff-filter=R --name-status --pretty=format:"COMMIT:%H|%cI" -- ${globs}`,
      { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }
    );
    if (!renameResult.stdout.trim()) return [];

    const renames: PluginRename[] = [];
    let currentCommit: { hash: string; date: string } | null = null;

    for (const line of renameResult.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('COMMIT:')) {
        const [hash, date] = trimmed.slice('COMMIT:'.length).split('|');
        currentCommit = { hash, date };
        continue;
      }

      if (currentCommit && trimmed.startsWith('R')) {
        // R100\told/path\tnew/path  or  R095\told/path\tnew/path
        const parts = trimmed.split('\t');
        if (parts.length >= 3) {
          const oldPath = parts[1];
          const newPath = parts[2];
          const oldName = extractPluginDirName(oldPath, pluginsDirs);
          const newName = extractPluginDirName(newPath, pluginsDirs);
          if (oldName && newName && oldName !== newName) {
            renames.push({
              oldName,
              newName,
              commitDate: currentCommit.date,
              commitHash: currentCommit.hash,
            });
          }
        }
      }
    }

    // Deduplicate: keep the most recent rename per old -> new pair
    const seen = new Map<string, PluginRename>();
    for (const rename of renames) {
      const key = `${rename.oldName}->${rename.newName}`;
      const existing = seen.get(key);
      if (!existing || new Date(rename.commitDate) > new Date(existing.commitDate)) {
        seen.set(key, rename);
      }
    }

    return Array.from(seen.values());
  } catch {
    return [];
  }
};

export const extractPluginDeletions = async (
  repoPath: string,
  pluginsDirs: string[],
  days: number = REMOVAL_EXPIRY_DAYS
): Promise<PluginDeletion[]> => {
  if (!(await hasGit(repoPath))) return [];

  const globs = buildPluginGlobs(pluginsDirs);
  try {
    const deleteResult = await execAsync(
      `git log --since="${days} days ago" --diff-filter=D --name-status --pretty=format:"COMMIT:%H|%cI" -- ${globs}`,
      { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }
    );
    if (!deleteResult.stdout.trim()) return [];

    // Also get renames so we can exclude renamed files from deletions
    const renames = await extractPluginRenames(repoPath, pluginsDirs, days);
    const renamedOldNamesLower = new Set(renames.map((r) => r.oldName.toLowerCase()));

    const deletions: PluginDeletion[] = [];
    let currentCommit: { hash: string; date: string } | null = null;

    for (const line of deleteResult.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('COMMIT:')) {
        const [hash, date] = trimmed.slice('COMMIT:'.length).split('|');
        currentCommit = { hash, date };
        continue;
      }

      if (currentCommit && trimmed.startsWith('D\t')) {
        const filePath = trimmed.slice(2);
        const pluginName = extractPluginDirName(filePath, pluginsDirs);
        if (pluginName && !renamedOldNamesLower.has(pluginName.toLowerCase())) {
          deletions.push({
            pluginName,
            commitDate: currentCommit.date,
            commitHash: currentCommit.hash,
          });
        }
      }
    }

    // Deduplicate: keep the most recent deletion per plugin name
    const seen = new Map<string, PluginDeletion>();
    for (const deletion of deletions) {
      const existing = seen.get(deletion.pluginName);
      if (!existing || new Date(deletion.commitDate) > new Date(existing.commitDate)) {
        seen.set(deletion.pluginName, deletion);
      }
    }

    return Array.from(seen.values());
  } catch {
    return [];
  }
};

export const extractPluginMigrations = async (
  repoPath: string,
  pluginsDirs: string[]
): Promise<PluginMigrationInfo> => {
  const [renames, deletions] = await Promise.all([
    extractPluginRenames(repoPath, pluginsDirs, RENAME_EXPIRY_DAYS),
    extractPluginDeletions(repoPath, pluginsDirs, REMOVAL_EXPIRY_DAYS),
  ]);

  return { renames, deletions };
};

export const extractDeprecationsFromGit = async (
  repoPath: string,
  pluginsDirs?: string[]
): Promise<DeprecationInfo[]> => {
  if (!(await hasGit(repoPath))) return [];

  const dirs = pluginsDirs ?? ['src/plugins'];
  const commits = await getRecentCommits(repoPath);

  const results = await Promise.all(
    commits.map(async ({ hash, date }) => {
      const files = await getCommitFiles(repoPath, hash);
      const pluginFiles = files.filter((f) => {
        return dirs.some((dir) => f.startsWith(dir) && PLUGIN_FILE_PATTERN.test(f));
      });

      const deprecations = await Promise.all(
        pluginFiles.map(async (file) => {
          const pluginName = extractPluginDirName(file, dirs) ?? file.split('/')[2];
          const removed = await getRemovedSettings(repoPath, file, `${hash}^`, hash);

          return removed.map((setting) => ({
            plugin: pluginName,
            setting,
            removed: true,
            commitDate: date,
            commitHash: hash,
          }));
        })
      );

      return deprecations.flat();
    })
  );

  return results.flat();
};
