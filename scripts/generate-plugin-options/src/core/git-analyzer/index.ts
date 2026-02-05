import { exec } from 'child_process';
import { join } from 'pathe';
import { promisify } from 'util';
import { pipe, filter, flatMap, map } from 'remeda';

const execAsync = promisify(exec);

const DAYS_TO_CHECK = 18;
const PLUGINS_DIR = 'src/plugins';
const PLUGIN_FILE_PATTERN = /index\.(ts|tsx)$/;

export type DeprecationInfo = {
  plugin: string;
  setting: string;
  removed: boolean;
  commitDate: string;
  commitHash: string;
};

const hasGit = async (path: string): Promise<boolean> => {
  try {
    await execAsync('git rev-parse --git-dir', { cwd: path });
    return true;
  } catch {
    return false;
  }
};

const getRecentCommits = async (repoPath: string): Promise<Array<{ hash: string; date: string }>> => {
  const { stdout } = await execAsync(
    `git log --since="${DAYS_TO_CHECK} days ago" --pretty=format:"%H|%cI"`,
    { cwd: repoPath }
  );
  if (!stdout.trim()) return [];

  return pipe(
    stdout.trim().split('\n'),
    map(line => {
      const [hash, date] = line.split('|');
      return { hash, date };
    })
  );
};

const getCommitFiles = async (repoPath: string, commitHash: string): Promise<string[]> => {
  const { stdout } = await execAsync(`git diff-tree --name-only -r ${commitHash}`, { cwd: repoPath });
  return stdout.trim().split('\n').filter(Boolean);
};

const getRemovedSettings = async (
  repoPath: string,
  filePath: string,
  oldHash: string,
  newHash: string
): Promise<string[]> => {
  try {
    const { stdout } = await execAsync(`git diff ${oldHash}..${newHash} -- "${filePath}"`, { cwd: repoPath });
    return pipe(
      stdout.split('\n'),
      filter(line => line.startsWith('-') && !line.startsWith('---')),
      map(line => line.match(/["'](\w+)["']\s*:/)?.[1]),
      filter((match): match is string => match !== undefined)
    );
  } catch {
    return [];
  }
};

export const extractDeprecationsFromGit = async (repoPath: string): Promise<DeprecationInfo[]> => {
  if (!(await hasGit(repoPath))) return [];

  const commits = await getRecentCommits(repoPath);

  const results = await Promise.all(
    commits.map(async ({ hash, date }) => {
      const files = await getCommitFiles(repoPath, hash);
      const pluginFiles = files.filter(f => f.startsWith(PLUGINS_DIR) && PLUGIN_FILE_PATTERN.test(f));

      const deprecations = await Promise.all(
        pluginFiles.map(async file => {
          const pluginName = file.split('/')[2];
          const removed = await getRemovedSettings(repoPath, file, `${hash}^`, hash);

          return removed.map(setting => ({
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
