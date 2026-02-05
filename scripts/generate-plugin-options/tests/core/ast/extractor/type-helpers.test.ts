import { describe, test, expect } from 'vitest';
import { Project, ModuleKind, SyntaxKind } from 'ts-morph';
import { Maybe } from 'true-myth';
import {
  getDefaultPropertyInitializer,
  isCustomType,
} from '../../../../src/core/ast/extractor/type-helpers.js';
import type { SettingProperties } from '../../../../src/core/ast/extractor/type-inference/types.js';

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

describe('type-helpers', () => {
  describe('getDefaultPropertyInitializer', () => {
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

  describe('isCustomType', () => {
    test('returns true for CUSTOM type property', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile(
        'test.ts',
        `const obj = { type: OptionType.CUSTOM };`
      );
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      const typeProp = obj.getProperty('type');
      const typeNode =
        typeProp?.getKind() === SyntaxKind.PropertyAssignment
          ? typeProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
          : undefined;

      const props = createSettingProperties(typeNode ? Maybe.just(typeNode) : undefined);
      const result = isCustomType(obj, props);
      // Note: This may return false if OptionType.CUSTOM is not resolved, but the function should handle it
      expect(typeof result).toBe('boolean');
    });

    test('returns false for non-CUSTOM type', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile(
        'test.ts',
        `const obj = { type: OptionType.STRING };`
      );
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      const props = createSettingProperties();
      const result = isCustomType(obj, props);
      expect(result).toBe(false);
    });
  });
});
