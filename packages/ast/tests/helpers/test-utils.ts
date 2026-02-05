import { Project, ModuleKind } from 'ts-morph';
import { createMinimalProps } from '../../src/extractor/type-inference/types.js';
import type { SettingProperties } from '../../src/extractor/type-inference/types.js';

export function createProject(): Project {
  return new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    compilerOptions: {
      target: 99, // ES2022
      module: ModuleKind.ESNext,
      jsx: 2, // React
      allowJs: true,
      skipLibCheck: true,
    },
  });
}

export function createSettingProperties(
  overrides: Partial<SettingProperties> = {}
): SettingProperties {
  return { ...createMinimalProps(), ...overrides };
}
