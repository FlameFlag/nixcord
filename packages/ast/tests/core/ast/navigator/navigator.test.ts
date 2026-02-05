import { describe, test, expect } from 'vitest';
import { Project, ModuleKind, SyntaxKind } from 'ts-morph';
import {
  findAllPropertyAssignments,
  findPropertyAssignment,
  findNestedObjectLiterals,
} from '../../../../src/navigator/node-traversal.js';
import {
  findCallExpressionByName,
  unwrapChainedCall,
  findCallExpressionByNameUnwrappingChains,
} from '../../../../src/navigator/pattern-matcher.js';
import {
  findDefinePluginCall,
  findDefinePluginSettings,
} from '../../../../src/navigator/plugin-navigator.js';

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

describe('node-traversal', () => {
  describe('findAllPropertyAssignments', () => {
    test('finds all property assignments in object literal', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile(
        'test.ts',
        `const obj = { prop1: "value1", prop2: "value2", prop3: "value3" };`
      );
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      const props = findAllPropertyAssignments(obj);
      expect(props.length).toBe(3);
      expect(props[0]?.getNameNode().getText()).toBe('prop1');
      expect(props[1]?.getNameNode().getText()).toBe('prop2');
      expect(props[2]?.getNameNode().getText()).toBe('prop3');
    });

    test('returns empty array for empty object', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `const obj = {};`);
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      const props = findAllPropertyAssignments(obj);
      expect(props.length).toBe(0);
    });
  });

  describe('findPropertyAssignment', () => {
    test('finds property assignment by name', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile(
        'test.ts',
        `const obj = { name: "test", value: 42 };`
      );
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      const prop = findPropertyAssignment(obj, 'name');
      expect(prop).toBeDefined();
      expect(prop?.getNameNode().getText()).toBe('name');
    });

    test('returns undefined for non-existent property', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `const obj = { name: "test" };`);
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      const prop = findPropertyAssignment(obj, 'nonexistent');
      expect(prop).toBeUndefined();
    });
  });

  describe('findNestedObjectLiterals', () => {
    test('finds nested object literals', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile(
        'test.ts',
        `const obj = { outer: { inner: { deep: "value" } } };`
      );
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      const nested = Array.from(findNestedObjectLiterals(obj));
      expect(nested.length).toBeGreaterThan(1);
    });

    test('includes the root object literal', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `const obj = { prop: "value" };`);
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      const nested = Array.from(findNestedObjectLiterals(obj));
      expect(nested.length).toBeGreaterThanOrEqual(1);
      expect(nested[0]).toBe(obj);
    });
  });
});

describe('pattern-matcher', () => {
  describe('findCallExpressionByName', () => {
    test('finds call expression by function name', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `myFunction(); otherFunction();`);

      const result = findCallExpressionByName(sourceFile, 'myFunction');
      expect(result).toBeDefined();
      if (result !== undefined) {
        const expr = result.getExpression();
        expect(expr.getKind()).toBe(SyntaxKind.Identifier);
        expect(expr.getText()).toBe('myFunction');
      }
    });

    test('returns nothing for non-existent function', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `myFunction();`);

      const result = findCallExpressionByName(sourceFile, 'nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('unwrapChainedCall', () => {
    test('unwraps chained method calls', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile(
        'test.ts',
        `original().chainMethod1().chainMethod2();`
      );
      const callExpr = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!callExpr) throw new Error('Expected call expression');

      const unwrapped = unwrapChainedCall(callExpr, ['chainMethod1', 'chainMethod2']);
      const expr = unwrapped.getExpression();
      expect(expr.getText()).toBe('original');
    });

    test('returns original call if no chain found', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `myFunction();`);
      const callExpr = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!callExpr) throw new Error('Expected call expression');

      const unwrapped = unwrapChainedCall(callExpr, ['chainMethod']);
      expect(unwrapped).toBe(callExpr);
    });
  });

  describe('findCallExpressionByNameUnwrappingChains', () => {
    test('finds call expression and unwraps chains', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `original().withPrivateSettings();`);

      const result = findCallExpressionByNameUnwrappingChains(sourceFile, 'original', [
        'withPrivateSettings',
      ]);
      expect(result).toBeDefined();
      if (result !== undefined) {
        const expr = result.getExpression();
        expect(expr.getText()).toBe('original');
      }
    });
  });
});

describe('plugin-navigator', () => {
  describe('findDefinePluginCall', () => {
    test('finds definePlugin call', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile(
        'test.ts',
        `export default definePlugin({ name: "Test" });`
      );

      const result = findDefinePluginCall(sourceFile);
      expect(result).toBeDefined();
    });

    test('returns nothing when definePlugin not found', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `const x = 1;`);

      const result = findDefinePluginCall(sourceFile);
      expect(result).toBeUndefined();
    });
  });

  describe('findDefinePluginSettings', () => {
    test('finds definePluginSettings call', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile(
        'test.ts',
        `const settings = definePluginSettings({ option: { type: OptionType.STRING } });`
      );

      const result = findDefinePluginSettings(sourceFile);
      expect(result).toBeDefined();
    });

    test('unwraps chained withPrivateSettings call', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile(
        'test.ts',
        `const settings = definePluginSettings({}).withPrivateSettings<{}>();`
      );

      const result = findDefinePluginSettings(sourceFile);
      expect(result).toBeDefined();
      if (result !== undefined) {
        const expr = result.getExpression();
        expect(expr.getText()).toBe('definePluginSettings');
      }
    });
  });
});
