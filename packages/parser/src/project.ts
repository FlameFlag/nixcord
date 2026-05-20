import fg from 'fast-glob';
import fse from 'fs-extra';
import { join, normalize } from 'pathe';
import { Project, ts } from 'ts-morph';

const TSCONFIG_FILE_NAME = 'tsconfig.json';

export async function createProject(sourcePath: string): Promise<Project> {
  const tsConfigPath = normalize(join(sourcePath, TSCONFIG_FILE_NAME));
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
      allowJs: true,
      skipLibCheck: true,
    },
    tsConfigFilePath: (await fse.pathExists(tsConfigPath)) ? tsConfigPath : undefined,
  });

  const typesPath = normalize(join(sourcePath, 'src/utils/types.ts'));
  if (await fse.pathExists(typesPath)) project.addSourceFileAtPath(typesPath);

  const discordEnumsDir = normalize(join(sourcePath, 'packages/discord-types/enums'));
  if (await fse.pathExists(discordEnumsDir)) {
    for (const file of await fg('**/*.ts', {
      cwd: discordEnumsDir,
      absolute: false,
      onlyFiles: true,
    })) {
      project.addSourceFileAtPath(normalize(join(discordEnumsDir, file)));
    }
  }

  const shikiThemesPath = normalize(
    join(sourcePath, 'src/plugins/shikiCodeblocks.desktop/api/themes.ts')
  );
  if (await fse.pathExists(shikiThemesPath)) project.addSourceFileAtPath(shikiThemesPath);

  return project;
}
