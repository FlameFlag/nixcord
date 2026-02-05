import { describe, test, expect } from 'vitest';
import { Project, SyntaxKind, ModuleKind } from 'ts-morph';
import {
  getDefaultPropertyInitializer,
  isCustomType,
} from '../../../../src/core/ast/extractor/type-helpers.js';
import type { SettingProperties } from '../../../../src/core/ast/extractor/type-inference/types.js';
import { Maybe } from 'true-myth';

function createProject(): Project {
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

function createSettingProperties(typeNode?: Maybe<any>): SettingProperties {
  return {
    typeNode: typeNode || Maybe.nothing(),
    description: undefined,
    placeholder: undefined,
    restartNeeded: false,
    hidden: Maybe.nothing(),
    defaultLiteralValue: undefined,
  };
}

describe('getDefaultPropertyInitializer()', () => {
  test('returns default property initializer when exists', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const obj = { default: "value" };`);
    const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
    if (!obj) throw new Error('Expected object literal');

    const init = getDefaultPropertyInitializer(obj);
    expect(init).toBeDefined();
    expect(init?.getKind()).toBe(SyntaxKind.StringLiteral);
  });

  test('returns undefined when default property does not exist', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const obj = { prop: "value" };`);
    const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
    if (!obj) throw new Error('Expected object literal');

    const init = getDefaultPropertyInitializer(obj);
    expect(init).toBeUndefined();
  });
});

describe('isCustomType()', () => {
  test('handles type property access', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const obj = { type: OptionType.CUSTOM };`
    );
    const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
    if (!obj) throw new Error('Expected object literal');

    const props = createSettingProperties();
    const result = isCustomType(obj, props);
    expect(typeof result).toBe('boolean');
  });
});
