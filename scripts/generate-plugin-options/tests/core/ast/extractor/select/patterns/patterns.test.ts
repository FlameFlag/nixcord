import { describe, test, expect } from 'vitest';
import { Project, ModuleKind, SyntaxKind } from 'ts-morph';
import {
  isArrayLiteral,
  isMapCall,
  isArrayMapCall,
  isObjectKeysCall,
  isObjectValuesCall,
  isObjectKeysMapCall,
  isObjectValuesMapCall,
  getObjectMethodTargetIdentifier,
  isArrayFromCall,
  isCallExpression,
} from '../../../../../../src/core/ast/extractor/select/patterns/index.js';

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

describe('array-matcher', () => {
  describe('isArrayLiteral', () => {
    test('returns true for array literal', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `const arr = [1, 2, 3];`);
      const arr = sourceFile.getFirstDescendantByKind(SyntaxKind.ArrayLiteralExpression);
      if (!arr) throw new Error('Expected array literal');

      expect(isArrayLiteral(arr)).toBe(true);
    });

    test('returns false for non-array', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `const obj = { prop: "value" };`);
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      expect(isArrayLiteral(obj)).toBe(false);
    });
  });

  describe('isMapCall', () => {
    test('returns true for .map() call', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `[1, 2, 3].map(x => x * 2);`);
      const call = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!call) throw new Error('Expected call expression');

      expect(isMapCall(call)).toBe(true);
    });

    test('returns false for non-map call', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `myFunction();`);
      const call = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!call) throw new Error('Expected call expression');

      expect(isMapCall(call)).toBe(false);
    });
  });

  describe('isArrayMapCall', () => {
    test('returns true for array.map() pattern', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `[1, 2, 3].map(x => x * 2);`);
      const call = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!call) throw new Error('Expected call expression');

      expect(isArrayMapCall(call)).toBe(true);
    });

    test('returns false for non-array.map() pattern', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `obj.map(x => x);`);
      const call = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!call) throw new Error('Expected call expression');

      expect(isArrayMapCall(call)).toBe(false);
    });
  });
});

describe('object-matcher', () => {
  describe('isObjectKeysCall', () => {
    test('returns true for Object.keys() call', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `Object.keys({ a: 1, b: 2 });`);
      const call = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!call) throw new Error('Expected call expression');

      expect(isObjectKeysCall(call)).toBe(true);
    });

    test('returns false for Object.values() call', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `Object.values({ a: 1, b: 2 });`);
      const call = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!call) throw new Error('Expected call expression');

      expect(isObjectKeysCall(call)).toBe(false);
    });
  });

  describe('isObjectValuesCall', () => {
    test('returns true for Object.values() call', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `Object.values({ a: 1, b: 2 });`);
      const call = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!call) throw new Error('Expected call expression');

      expect(isObjectValuesCall(call)).toBe(true);
    });
  });

  describe('isObjectKeysMapCall', () => {
    test('returns true for Object.keys().map() pattern', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile(
        'test.ts',
        `Object.keys({ a: 1, b: 2 }).map(k => k);`
      );
      const call = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!call) throw new Error('Expected call expression');

      // Find the outer map call
      const mapCall =
        call.getExpression().getKind() === SyntaxKind.PropertyAccessExpression ? call : undefined;
      if (!mapCall) throw new Error('Expected map call');

      expect(isObjectKeysMapCall(mapCall)).toBe(true);
    });
  });

  describe('isObjectValuesMapCall', () => {
    test('returns true for Object.values().map() pattern', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile(
        'test.ts',
        `Object.values({ a: 1, b: 2 }).map(v => v);`
      );
      const call = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!call) throw new Error('Expected call expression');

      // Find the outer map call
      const mapCall =
        call.getExpression().getKind() === SyntaxKind.PropertyAccessExpression ? call : undefined;
      if (!mapCall) throw new Error('Expected map call');

      expect(isObjectValuesMapCall(mapCall)).toBe(true);
    });
  });

  describe('getObjectMethodTargetIdentifier', () => {
    test('extracts identifier from Object.keys() call', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `Object.keys(myObj);`);
      const call = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!call) throw new Error('Expected call expression');

      const ident = getObjectMethodTargetIdentifier(call);
      expect(ident).toBeDefined();
      expect(ident?.getText()).toBe('myObj');
    });
  });
});

describe('call-matcher', () => {
  describe('isArrayFromCall', () => {
    test('returns true for Array.from() call', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `Array.from([1, 2, 3]);`);
      const call = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!call) throw new Error('Expected call expression');

      expect(isArrayFromCall(call)).toBe(true);
    });

    test('returns false for non-Array.from() call', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `myFunction();`);
      const call = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!call) throw new Error('Expected call expression');

      expect(isArrayFromCall(call)).toBe(false);
    });
  });

  describe('isCallExpression', () => {
    test('returns true for call expression', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `myFunction();`);
      const call = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!call) throw new Error('Expected call expression');

      expect(isCallExpression(call)).toBe(true);
    });

    test('returns false for non-call expression', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `const x = 1;`);
      const varDecl = sourceFile.getFirstDescendantByKind(SyntaxKind.VariableDeclaration);
      if (!varDecl) throw new Error('Expected variable declaration');

      expect(isCallExpression(varDecl)).toBe(false);
    });
  });
});
