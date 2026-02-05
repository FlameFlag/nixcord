import { describe, test, expect } from 'vitest';
import { Project, ModuleKind, SyntaxKind } from 'ts-morph';
import {
  extractOptionsFromArrayMap,
  extractOptionsFromArrayFrom,
} from '../../../../../../src/extractor/select/options/array-patterns.js';

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

describe('array-patterns', () => {
  describe('extractOptionsFromArrayMap', () => {
    test('extracts options from array.map() pattern', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile(
        'test.ts',
        `const options = ["option1", "option2", "option3"];`
      );
      const arr = sourceFile.getFirstDescendantByKind(SyntaxKind.ArrayLiteralExpression);
      if (!arr) throw new Error('Expected array literal');

      const checker = project.getTypeChecker();
      const result = extractOptionsFromArrayMap(arr, checker);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.values.length).toBeGreaterThan(0);
      }
    });

    test('returns error for non-array node', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `const obj = { prop: "value" };`);
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      const checker = project.getTypeChecker();
      const result = extractOptionsFromArrayMap(obj, checker);

      expect(result.ok).toBe(false);
    });
  });

  describe('extractOptionsFromArrayFrom', () => {
    test('extracts options from Array.from() with array literal', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile(
        'test.ts',
        `const options = Array.from(["option1", "option2"]);`
      );
      const call = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!call) throw new Error('Expected call expression');

      const checker = project.getTypeChecker();
      const result = extractOptionsFromArrayFrom(call, checker);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.values.length).toBeGreaterThan(0);
      }
    });

    test('returns error for non-Array.from() call', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `myFunction();`);
      const call = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!call) throw new Error('Expected call expression');

      const checker = project.getTypeChecker();
      const result = extractOptionsFromArrayFrom(call, checker);

      expect(result.ok).toBe(false);
    });

    test('returns error when Array.from() has no arguments', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `Array.from();`);
      const call = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!call) throw new Error('Expected call expression');

      const checker = project.getTypeChecker();
      const result = extractOptionsFromArrayFrom(call, checker);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('MissingProperty');
        expect(result.error.message).toContain('Array.from() requires at least one argument');
      }
    });

    test('extracts options from Array.from() with identifier', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile(
        'test.ts',
        `const OPTIONS = ["option1", "option2"];
        const options = Array.from(OPTIONS);`
      );
      const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
      const arrayFromCall = calls.find((call) => {
        const expr = call.getExpression();
        if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
          return expr.getText() === 'Array.from';
        }
        return false;
      });
      if (!arrayFromCall) throw new Error('Expected Array.from() call');

      const checker = project.getTypeChecker();
      const result = extractOptionsFromArrayFrom(arrayFromCall, checker);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.values.length).toBe(2);
        expect(result.value.values).toContain('option1');
        expect(result.value.values).toContain('option2');
      }
    });

    test('returns error when Array.from() identifier does not resolve to array', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile(
        'test.ts',
        `const NOT_ARRAY = "not an array";
        const options = Array.from(NOT_ARRAY);`
      );
      const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
      const arrayFromCall = calls.find((call) => {
        const expr = call.getExpression();
        if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
          return expr.getText() === 'Array.from';
        }
        return false;
      });
      if (!arrayFromCall) throw new Error('Expected Array.from() call');

      const checker = project.getTypeChecker();
      const result = extractOptionsFromArrayFrom(arrayFromCall, checker);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('UnsupportedPattern');
      }
    });

    test('handles array map with all extraction failures', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile(
        'test.ts',
        `const options = [() => {}, () => {}];`
      );
      const arr = sourceFile.getFirstDescendantByKind(SyntaxKind.ArrayLiteralExpression);
      if (!arr) throw new Error('Expected array literal');

      const checker = project.getTypeChecker();
      const result = extractOptionsFromArrayMap(arr, checker);

      // When all extractions fail and no values are extracted, should return error
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('CannotEvaluate');
        expect(result.error.message).toContain('Failed to extract options');
      }
    });
  });
});
