import { describe, test, expect } from 'vitest';
import { SyntaxKind } from 'ts-morph';
import {
  getDefaultPropertyInitializer,
  isCustomType,
} from '../../../../src/extractor/type-helpers.js';
import { createProject, createSettingProperties } from '../../../helpers/test-utils.js';

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
