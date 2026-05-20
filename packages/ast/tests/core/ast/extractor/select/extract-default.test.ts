import { SyntaxKind } from 'ts-morph';
import { describe, expect, test } from 'vitest';
import {
  extractSelectDefault,
  extractSelectOptions,
} from '../../../../../src/extractor/select/index.js';
import { createProject, unwrapResult } from '../../../../helpers/test-utils.js';

describe('extractSelectDefault()', () => {
  test('extracts default from options with default: true', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const obj = {
        options: [
          { label: "First", value: "first" },
          { label: "Second", value: "second", default: true },
          { label: "Third", value: "third" }
        ]
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectDefault(objLiteral, checker));
    expect(result).toBe('second');
  });

  test('extracts numeric default values', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const obj = {
        options: [
          { label: "Compact", value: 0, default: true },
          { label: "Cozy", value: 1 }
        ]
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectDefault(objLiteral, checker));
    expect(result).toBe(0);
  });

  test('returns undefined when no default is present', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const obj = {
        options: [
          { label: "First", value: "first" },
          { label: "Second", value: "second" }
        ]
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectDefault(objLiteral, checker));
    expect(result).toBeUndefined();
  });

  test('extracts default from Object.keys().map() pattern', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const Methods = { Random: 0, Constant: 1 };
      const obj = {
        options: Object.keys(Methods).map((k, index) => ({
          label: k,
          value: (Methods as any)[k],
          default: index === 0
        }))
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectDefault(objLiteral, checker));
    expect(result).toBe('Random');
  });

  test('extracts default with boolean enum (2 boolean values)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const obj = {
        options: [
          { label: "Yes", value: true, default: true },
          { label: "No", value: false }
        ]
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectDefault(objLiteral, checker));
    expect(result).toBe(true);
  });

  test('extracts default from binary expression inside array.map callback', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'binary-default.ts',
      `
      const obj = {
        options: ["128", "256", "1024"].map(size => ({
          label: size,
          value: size,
          default: size === "1024"
        }))
      };
      `
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectDefault(objLiteral, checker));
    expect(result).toBe('1024');
  });

  test('returns undefined when a non-map call is used for options', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'filter-default.ts',
      `
      const options = ["first", "second"];
      const obj = {
        options: options.filter(Boolean)
      };
      `
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = extractSelectDefault(objLiteral, checker);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected successful result');
    }
    expect(result.value).toBeUndefined();
  });

  // Array.from() without arguments throws before we can analyze it, so we skip testing that branch

  test('extracts first option when defaults cannot be inferred', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'view-icons.ts',
      `
      const obj = {
        options: ["128", "256", "512", "1024", "2048"].map(size => ({
          label: size,
          value: size,
          default: size === "1024",
        })),
      };
      `
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectDefault(objLiteral, checker));
    expect(result).toBe('1024');
  });

  test('extracts default from identifier.map equality check (format selector)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'identifier-map.ts',
      `
      const formats = ["webp", "png", "jpg"] as const;
      const obj = {
        options: formats.map(format => ({
          label: format,
          value: format,
          default: format === "png",
        })),
      };
      `
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectDefault(objLiteral, checker));
    expect(result).toBe('png');
  });

  test('falls back to the first literal when map default expression is not comparable', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'map-fallback.ts',
      `
      function preferLarge(value: string) {
        return value.length > 4;
      }
      const obj = {
        options: ["Mini", "Large"].map(mode => ({
          value: mode,
          default: preferLarge(mode),
        })),
      };
      `
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectDefault(objLiteral, checker));
    expect(result).toBe('Mini');
  });

  test('detects defaults inside spread arrays', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'spread-default.ts',
      `
      const baseOptions = [
        { label: "Original", value: "base", default: true }
      ];
      const obj = {
        options: [
          ...baseOptions,
          { label: "Override", value: "override" }
        ]
      };
      `
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectDefault(objLiteral, checker));
    expect(result).toBe('base');
  });

  test('extracts values via Object.values().map pattern', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'object-values-success.ts',
      `
      const PronounsFormat = {
        Lowercase: "lowercase",
        Capitalized: "capitalized"
      } as const;
      const obj = {
        options: Object.values(PronounsFormat).map(value => ({
          value
        }))
      };
      `
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    expect(result).toBeDefined();
    expect(result!.values).toEqual(['lowercase', 'capitalized']);
  });

  test('merges spread arrays when extracting options', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'spread-options.ts',
      `
      const baseOptions = [
        { label: "Base", value: "base", default: true }
      ];
      const obj = {
        options: [
          ...baseOptions,
          { label: "Extra", value: "extra" }
        ]
      };
      `
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    expect(result).toBeDefined();
    expect(result!.values).toEqual(['base', 'extra']);
    expect(result!.labels).toEqual({ base: 'Base', extra: 'Extra' });
  });

  test('gracefully returns empty results when using .filter instead of .map', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'filter-pattern.ts',
      `
      const options = ["a", "b"];
      const obj = {
        options: options.filter(Boolean)
      };
      `
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    expect(result).toBeDefined();
    expect(result!.values).toEqual([]);
  });
});
