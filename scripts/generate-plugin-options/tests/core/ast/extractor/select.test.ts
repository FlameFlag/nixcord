import { describe, test, expect, vi } from 'vitest';
import { Project, SyntaxKind, ModuleKind } from 'ts-morph';
import {
  extractSelectOptions,
  extractSelectDefault,
} from '../../../../src/core/ast/extractor/select/index.js';
import * as nodeUtils from '../../../../src/core/ast/extractor/node-utils.js';
import { evaluateThemesValues } from '../../../../src/core/ast/extractor/node-utils.js';

function unwrapResult<T>(result: {
  isOk: boolean;
  value?: T;
  error?: { message: string };
}): T | undefined {
  if (result.isOk) return result.value;
  throw new Error(result.error?.message ?? 'Unexpected error');
}

function expectResultError(
  result: {
    isOk: boolean;
    error?: { message: string };
  },
  matcher?: string | RegExp
): string {
  expect(result.isOk).toBe(false);
  const message = result.error?.message ?? '';
  if (typeof matcher === 'string') {
    expect(message).toContain(matcher);
  } else if (matcher) {
    expect(message).toMatch(matcher);
  }
  return message;
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

describe('extractSelectOptions()', () => {
  test('handles spread arrays in options', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `
      const valueOperation = [
        { label: "A", value: 0 },
        { label: "B", value: 1 },
      ];
      const obj = { options: [ ...valueOperation, { label: "C", value: 2 } ] };
      `
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    expect(result).toBeDefined();
    expect(result!.values).toEqual([0, 1, 2]);
    expect(result!.labels).toEqual({ 0: 'A', 1: 'B', 2: 'C' });
  });

  test('handles Object.keys(obj).map pattern with as const', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `
      const Methods = { Random: 0, Constant: 1 } as const;
      const obj = { options: Object.keys(Methods).map((k: any) => ({ label: k, value: (Methods as any)[k] })) };
      `
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    // Should now extract keys from the Methods object
    expect(result).toBeDefined();
    expect(result!.values).toEqual(['Random', 'Constant']);
  });

  test('handles themeNames.map pattern (Object.keys(themes) as const)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `
      const themes = {
        DarkPlus: "https://example.com/dark-plus.json",
        LightPlus: "https://example.com/light-plus.json",
      };
      const themeNames = Object.keys(themes) as (keyof typeof themes)[];
      const obj = { options: themeNames.map(name => ({ value: themes[name] })) };
      `
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    // Should extract theme URLs or at least the keys
    expect(result).toBeDefined();
    if (result) {
      expect(result.values.length).toBeGreaterThan(0);
    }
  });

  test('handles Object.values().map() pattern', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `
      const Values = { First: "value1", Second: "value2" } as const;
      const obj = { options: Object.values(Values).map(v => ({ value: v })) };
      `
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    // Should extract values from object
    expect(result).toBeDefined();
    expect(result!.values).toEqual(['value1', 'value2']);
  });

  test('handles Array.from() pattern with array literal', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `
      const obj = { options: Array.from([1, 2, 3]) };
      `
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    expect(result).toBeDefined();
    expect(result!.values).toEqual([1, 2, 3]);
  });

  test('handles Array.from() pattern with identifier', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `
      const languages = ["en", "ja", "es"];
      const obj = { options: Array.from(languages) };
      `
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    expect(result).toBeDefined();
    expect(result!.values).toEqual(['en', 'ja', 'es']);
  });

  test('handles boolean enum detection (converts to bool type)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const obj = {
        options: [
          { value: true },
          { value: false }
        ]
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    // Boolean enum should be detected and handled specially by the caller
    expect(result).toBeDefined();
    expect(result!.values).toEqual([true, false]);
  });
  test('extracts string values from array', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const obj = {
        options: [
          { value: "option1" },
          { value: "option2" }
        ]
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    expect(result).toBeDefined();
    expect(result!.values).toEqual(['option1', 'option2']);
  });

  test('extracts numeric values as literals', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const obj = {
        options: [
          { value: 1 },
          { value: 2 }
        ]
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    expect(result).toBeDefined();
    expect(result!.values).toEqual([1, 2]);
  });

  test('extracts boolean values as literals', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const obj = {
        options: [
          { value: true },
          { value: false }
        ]
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    expect(result).toBeDefined();
    expect(result!.values).toEqual([true, false]);
  });

  test('handles empty arrays', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const obj = { options: [] };`);
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    expect(result).toBeDefined();
    expect(result!.values).toEqual([]);
    expect(result!.labels).toEqual({});
  });

  test('handles missing options property', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const obj = { type: "STRING" };`);
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    expect(result).toBeDefined();
    expect(result!.values).toEqual([]);
    expect(result!.labels).toEqual({});
  });

  test('handles invalid array elements', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const obj = {
        options: [
          "invalid",
          { notValue: "test" },
          { value: "valid" }
        ]
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    expect(result).toBeDefined();
    expect(result!.values).toEqual(['valid']);
  });

  test('errors when every array element fails to resolve', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'array-error.ts',
      `const obj = {
        options: [
          { label: "Broken entry" }
        ]
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = extractSelectOptions(objLiteral, checker);
    expectResultError(result, "Missing 'value' property");
  });

  test('extracts shiki theme URLs from themeNames.map pattern (Vencord ShikiCodeblocks)', () => {
    const project = createProject();
    project.createSourceFile(
      'theme-data.ts',
      `
      export const SHIKI_REPO = "Vendicated/Vencord";
      export const SHIKI_REPO_COMMIT = "abcdef1234";
      export const shikiRepoTheme = (name: string) => name;
      export const themes = {
        DarkPlus: shikiRepoTheme("DarkPlus"),
        MaterialCandy: "https://themes.example/material.json"
      } as const;
      `
    );
    const settingsFile = project.createSourceFile(
      'theme-settings.ts',
      `
      import { themes } from "./theme-data";
      const themeNames = Object.keys(themes) as (keyof typeof themes)[];
      const obj = {
        options: themeNames.map(name => ({
          value: themes[name],
          label: name
        }))
      };
      `
    );
    project.resolveSourceFileDependencies();
    const evaluateSpy = vi
      .spyOn(nodeUtils, 'evaluateThemesValues')
      .mockImplementation(() => [
        'https://raw.githubusercontent.com/Vendicated/Vencord/abcdef1234/packages/tm-themes/themes/DarkPlus.json',
        'https://themes.example/material.json',
      ]);
    const objLiteral = settingsFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    expect(result).toBeDefined();
    expect(result!.values).toEqual([
      'https://raw.githubusercontent.com/Vendicated/Vencord/abcdef1234/packages/tm-themes/themes/DarkPlus.json',
      'https://themes.example/material.json',
    ]);
    expect(evaluateSpy).toHaveBeenCalled();
    evaluateSpy.mockRestore();
  });

  test('falls back to theme keys when evaluateThemesValues returns empty', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'theme-fallback.ts',
      `
      const themes = {
        DarkPlus: "https://dark",
        LightPlus: "https://light"
      };
      const themeNames = Object.keys(themes) as (keyof typeof themes)[];
      const obj = {
        options: themeNames.map(name => ({
          value: name
        }))
      };
      `
    );
    const evaluateSpy = vi.spyOn(nodeUtils, 'evaluateThemesValues').mockImplementation(() => []);
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    expect(result).toBeDefined();
    expect(result!.values).toEqual(['DarkPlus', 'LightPlus']);
    expect(evaluateSpy).toHaveBeenCalled();
    evaluateSpy.mockRestore();
  });

  test('falls back gracefully when theme names are produced by a factory call', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'theme-fallback.ts',
      `
      const themes = {
        DarkPlus: "dark",
        LightPlus: "light",
      } as const;

      function makeThemeNames() {
        return Object.keys(themes) as string[];
      }

      const obj = {
        options: makeThemeNames().map(name => ({
          value: themes[name as keyof typeof themes],
        })),
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

  test('returns empty when Object.values() argument is not an identifier', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'object-values.ts',
      `
      const obj = {
        options: Object.values(buildEnum()).map(entry => ({ value: entry })),
      };
      function buildEnum() {
        return { Primary: "primary", Secondary: "secondary" } as const;
      }
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

  test('returns empty when Array.from() argument cannot be statically resolved', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'array-from-set.ts',
      `
      const obj = {
        options: Array.from(new Set(["alpha", "beta"]), value => ({ value })),
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

  test('errors when option objects omit the value property', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'missing-value.ts',
      `
      const obj = {
        options: [
          { label: "Broken entry" }
        ]
      };
      `
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = extractSelectOptions(objLiteral, checker);
    expectResultError(result, "Missing 'value' property");
  });

  test('records labels for boolean-valued options', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'boolean-labels.ts',
      `
      const obj = {
        options: [
          { label: "Enabled", value: true },
          { label: "Disabled", value: false }
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
    expect(result!.labels['true']).toBe('Enabled');
    expect(result!.labels['false']).toBe('Disabled');
    expect(result!.values).toEqual([true, false]);
  });
});

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
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value).toBeUndefined();
    } else {
      throw new Error('Expected successful result');
    }
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
