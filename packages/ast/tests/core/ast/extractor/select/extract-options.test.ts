import { SyntaxKind } from 'ts-morph';
import { describe, expect, test, vi } from 'vitest';
import { extractSelectOptions } from '../../../../../src/extractor/select/index.js';
import { evaluateThemesValues } from '../../../../../src/foundation/index.js';
import * as resolve from '../../../../../src/foundation/resolve.js';
import { createProject, expectResultError, unwrapResult } from '../../../../helpers/test-utils.js';

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
      .spyOn(resolve, 'evaluateThemesValues')
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
    const evaluateSpy = vi.spyOn(resolve, 'evaluateThemesValues').mockImplementation(() => []);
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

  test('resolves Identifier referencing an external array', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'identifier-options.ts',
      `
      const selectOptions = [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ];
      const obj = { options: selectOptions };
      `
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    expect(result).toBeDefined();
    expect(result!.values).toEqual(['a', 'b']);
    expect(result!.labels).toEqual({ a: 'A', b: 'B' });
  });

  test('resolves Identifier referencing an external call expression', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'identifier-call.ts',
      `
      const selectOptions = ["x", "y", "z"].map(v => ({ value: v }));
      const obj = { options: selectOptions };
      `
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    // The identifier resolves to a CallExpression (.map), which should be handled
    const result = unwrapResult(extractSelectOptions(objLiteral, checker));
    expect(result).toBeDefined();
  });

  test('returns empty for unresolvable Identifier', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'unresolvable.ts',
      `
      declare const externalOptions: any;
      const obj = { options: externalOptions };
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
