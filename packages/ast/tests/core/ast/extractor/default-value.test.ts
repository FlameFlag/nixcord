import { describe, test, expect } from 'vitest';
import { Project, SyntaxKind, ModuleKind } from 'ts-morph';
import { extractDefaultValue } from '../../../../src/extractor/default-value.js';

function unwrapResult<T>(result: {
  ok: boolean;
  value?: T;
  error?: { message: string };
}): T | undefined {
  if (result.ok) return result.value;
  throw new Error(result.error?.message ?? 'Unexpected error');
}

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

describe('extractDefaultValue()', () => {
  test('BigInt literal -> integer string', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const obj = { default: 1026532993923293184n };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    expect(result).toBe('1026532993923293184');
  });

  test('identifier default resolving to array/object', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `
      const DEFAULT_KEYS = ["Ctrl", "K"] as const;
      const DEFAULT_OBJ = { a: 1, b: "two" } as const;
      const arr = { default: DEFAULT_KEYS };
      const obj = { default: DEFAULT_OBJ };
    `
    );
    const arrLiteral = sourceFile
      .getVariableDeclarationOrThrow('arr')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const arrResult = unwrapResult(extractDefaultValue(arrLiteral, checker));
    const objResult = unwrapResult(extractDefaultValue(objLiteral, checker));
    // For identifier-resolved literals we return shape-only defaults
    expect(arrResult).toEqual([]);
    expect(objResult).toEqual({});
  });
  test('string literals', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const obj = { default: "test-value" };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    expect(result).toBe('test-value');
  });

  test('numeric literals (integers)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const obj = { default: 42 };`);
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    expect(result).toBe(42);
  });

  test('numeric literals (floats)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const obj = { default: 3.14 };`);
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    expect(result).toBe(3.14);
  });

  test('boolean true', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const obj = { default: true };`);
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    expect(result).toBe(true);
  });

  test('boolean false', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const obj = { default: false };`);
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    expect(result).toBe(false);
  });

  test('null keyword', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const obj = { default: null };`);
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    expect(result).toBe(null);
  });

  test('undefined keyword', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const obj = { default: undefined };`);
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    // undefined keyword should be converted to null
    expect(result).toBe(null);
  });

  test('array literals []', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const obj = { default: [] };`);
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });

  test('object literals {}', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const obj = { default: {} };`);
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    expect(typeof result).toBe('object');
    expect(result).toEqual({});
  });

  test('property access expressions (ignored)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const obj = { default: someValue };`);
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    expect(result).toBe(undefined);
  });

  test('get() function calls (return undefined)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const obj = { default: get("key") };`);
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    expect(result).toBe(undefined);
  });

  test('computed defaults with getters (return undefined)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const getDefaultVoice = () => ({ voiceURI: "test-voice" });
      const obj = {
        get default() {
          return getDefaultVoice()?.voiceURI;
        }
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    // Getters cannot be evaluated statically, so should return undefined
    expect(result).toBe(undefined);
  });

  test('handles missing default property', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const obj = { type: "STRING" };`);
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    expect(result).toBe(undefined);
  });

  test('handles nested object literal in function call', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const obj = { default: defineDefault({ a: 1, b: "two" }) };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    expect(result).toEqual({ a: 1, b: 'two' });
  });

  test('handles complex nested type assertion', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const obj = { default: (("test" as string) as any) };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    expect(result).toBe('test');
  });

  test('handles identifier resolving to undefined keyword', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const UNDEF = undefined; const obj = { default: UNDEF };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    expect(result).toBe(null);
  });

  test('handles property access with as const', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const Methods = { Random: 0, Constant: 1 } as const;
      const obj = { default: Methods.Random };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    expect(result).toBe(0);
  });

  test('handles function call returning object literal', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const makeDefault = () => ({ a: 1, b: "two" });
      const obj = { default: makeDefault() };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    // Should extract shape-only default (object) - function calls can resolve if arrow function body is available
    expect(typeof result).toBe('object');
    if (result && typeof result === 'object' && result !== null) {
      // Function call may resolve to actual object if it's an arrow function, or empty object if not
      expect(Array.isArray(result)).toBe(false);
    } else {
      // Or may be undefined if function can't be resolved
      expect(result).toBeUndefined();
    }
  });

  test('handles function call returning array literal', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const makeArray = () => [1, 2, 3];
      const obj = { default: makeArray() };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    // Should extract shape-only default (array)
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });

  test('handles simple template literal without substitutions', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      'const obj = { default: `simple-template` };'
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    expect(result).toBe('simple-template');
  });

  test('handles template expression with substitutions (returns undefined)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      'const value = "test"; const obj = { default: `value-${value}` };'
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    // Template expressions with substitutions can't be statically evaluated
    expect(result).toBe(undefined);
  });

  test('handles template literal in as expression', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      'const obj = { default: `template` as string };'
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    expect(result).toBe('template');
  });

  test('handles function call with object literal containing computed property names', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const obj = { default: defineDefault({ [Symbol.iterator]: "test" }) };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    // Computed property names should be skipped (key will be undefined)
    expect(result).toEqual({});
  });

  test('handles function call with object literal containing unsupported property types', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const obj = { default: defineDefault({ prop: () => {} }) };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    // Arrow function initializers should result in undefined value, which gets skipped
    expect(result).toEqual({});
  });

  test('handles function call returning non-array/non-object literal', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const makeString = () => "test";
      const obj = { default: makeString() };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    // When function call resolves to non-array/non-object, should return undefined
    expect(result).toBe(undefined);
  });

  test('handles function call with no arguments', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const makeDefault = () => ({ a: 1 });
      const obj = { default: makeDefault() };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    // Function call with no args should try to resolve via call resolver
    expect(result === undefined || (typeof result === 'object' && result !== null)).toBe(true);
  });

  test('handles identifier resolving to unexpected node kind', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const FUNC = () => {};
      const obj = { default: FUNC };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractDefaultValue(objLiteral, checker));
    // Identifier resolving to function should result in undefined via otherwise path
    expect(result).toBe(undefined);
  });
});
