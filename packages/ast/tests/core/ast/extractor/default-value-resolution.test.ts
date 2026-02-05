import { describe, test, expect } from 'vitest';
import { Project, ModuleKind, SyntaxKind } from 'ts-morph';
import { resolveDefaultValue } from '../../../../src/extractor/default-value-resolution.js';

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

describe('resolveDefaultValue', () => {
  test('resolves default for enum type without explicit default', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const setting = {
        type: OptionType.SELECT,
        options: [
          { value: "option1", label: "Option 1" },
          { value: "option2", label: "Option 2" }
        ]
      };`
    );
    const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
    if (!obj) throw new Error('Expected object literal');

    const checker = project.getTypeChecker();
    const result = resolveDefaultValue(
      obj,
      'types.enum',
      undefined,
      ['option1', 'option2'],
      checker
    );

    expect(result.finalNixType).toBe('types.enum');
    expect(result.defaultValue).toBe('option1'); // Should default to first enum value
  });

  test('resolves null default for nullable string type', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const setting = { type: OptionType.STRING };`
    );
    const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
    if (!obj) throw new Error('Expected object literal');

    const checker = project.getTypeChecker();
    const result = resolveDefaultValue(obj, 'types.str', undefined, undefined, checker);

    expect(result.finalNixType).toBe('types.nullOr types.str');
    expect(result.defaultValue).toBe(null);
  });

  test('resolves false default for boolean type without explicit default', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const setting = { type: OptionType.BOOLEAN };`
    );
    const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
    if (!obj) throw new Error('Expected object literal');

    const checker = project.getTypeChecker();
    const result = resolveDefaultValue(obj, 'types.bool', undefined, undefined, checker);

    expect(result.finalNixType).toBe('types.bool');
    expect(result.defaultValue).toBe(false);
  });

  test('preserves explicit default value', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const setting = { type: OptionType.STRING, default: "explicit" };`
    );
    const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
    if (!obj) throw new Error('Expected object literal');

    const checker = project.getTypeChecker();
    const result = resolveDefaultValue(obj, 'types.str', 'explicit', undefined, checker);

    expect(result.finalNixType).toBe('types.str');
    expect(result.defaultValue).toBe('explicit');
  });

  test('resolves empty object default for attrs type without default', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const setting = { type: OptionType.COMPONENT };`
    );
    const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
    if (!obj) throw new Error('Expected object literal');

    const checker = project.getTypeChecker();
    const result = resolveDefaultValue(obj, 'types.attrs', undefined, undefined, checker);

    expect(result.finalNixType).toBe('types.attrs');
    expect(result.defaultValue).toEqual({});
  });
});
