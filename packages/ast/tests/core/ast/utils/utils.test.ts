import { describe, test, expect } from 'vitest';
import { Project, ModuleKind, SyntaxKind } from 'ts-morph';
import {
  asKind,
  getPropertyAssignment,
  getPropertyInitializer,
  extractStringLiteralValue,
  extractBooleanLiteralValue,
  getPropertyName,
  iteratePropertyAssignments,
  hasProperty,
  isMethodCall,
  getFirstArgumentOfKind,
} from '../../../../src/utils/node-helpers.js';
import { resolveIdentifierInitializerNode } from '../../../../src/extractor/node-utils.js';

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

describe('node-helpers', () => {
  describe('asKind', () => {
    test('returns node for matching kind', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `const x = 1;`);
      const varDecl = sourceFile.getFirstDescendantByKind(SyntaxKind.VariableDeclaration);
      if (!varDecl) throw new Error('Expected variable declaration');

      const result = asKind(varDecl, SyntaxKind.VariableDeclaration);
      expect(result).toBeDefined();
    });

    test('returns undefined for non-matching kind', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `const x = 1;`);
      const varDecl = sourceFile.getFirstDescendantByKind(SyntaxKind.VariableDeclaration);
      if (!varDecl) throw new Error('Expected variable declaration');

      const result = asKind(varDecl, SyntaxKind.Identifier);
      expect(result).toBeUndefined();
    });
  });

  describe('getPropertyAssignment', () => {
    test('returns property assignment when exists', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `const obj = { prop: "value" };`);
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      const result = getPropertyAssignment(obj, 'prop');
      expect(result).toBeDefined();
    });

    test('returns undefined for non-existent property', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `const obj = { prop: "value" };`);
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      const result = getPropertyAssignment(obj, 'nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('getPropertyInitializer', () => {
    test('returns initializer when property exists', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `const obj = { prop: "value" };`);
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      const result = getPropertyInitializer(obj, 'prop');
      expect(result).toBeDefined();
    });
  });

  describe('extractStringLiteralValue', () => {
    test('extracts string literal value', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `const obj = { prop: "value" };`);
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      const result = extractStringLiteralValue(obj, 'prop');
      expect(result).toBe('value');
    });
  });

  describe('extractBooleanLiteralValue', () => {
    test('extracts true boolean literal', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `const obj = { prop: true };`);
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      const result = extractBooleanLiteralValue(obj, 'prop');
      expect(result).toBe(true);
    });

    test('extracts false boolean literal', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `const obj = { prop: false };`);
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      const result = extractBooleanLiteralValue(obj, 'prop');
      expect(result).toBe(false);
    });
  });

  describe('getPropertyName', () => {
    test('extracts property name from identifier', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `const obj = { prop: "value" };`);
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      const prop = obj.getProperty('prop');
      if (!prop || prop.getKind() !== SyntaxKind.PropertyAssignment) {
        throw new Error('Expected property assignment');
      }

      const result = getPropertyName(prop.asKindOrThrow(SyntaxKind.PropertyAssignment));
      expect(result).toBe('prop');
    });
  });

  describe('iteratePropertyAssignments', () => {
    test('iterates over property assignments', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile(
        'test.ts',
        `const obj = { prop1: "value1", prop2: "value2" };`
      );
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      const props = Array.from(iteratePropertyAssignments(obj));
      expect(props.length).toBe(2);
    });
  });

  describe('hasProperty', () => {
    test('returns true when property exists', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `const obj = { prop: "value" };`);
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      expect(hasProperty(obj, 'prop')).toBe(true);
    });

    test('returns false when property does not exist', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `const obj = { prop: "value" };`);
      const obj = sourceFile.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) throw new Error('Expected object literal');

      expect(hasProperty(obj, 'nonexistent')).toBe(false);
    });
  });

  describe('isMethodCall', () => {
    test('returns property access for matching method call', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `obj.map(x => x);`);
      const call = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!call) throw new Error('Expected call expression');

      const result = isMethodCall(call, 'map');
      expect(result).toBeDefined();
    });
  });

  describe('getFirstArgumentOfKind', () => {
    test('returns first argument of matching kind', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile('test.ts', `myFunction("arg1", 42);`);
      const call = sourceFile.getFirstDescendantByKind(SyntaxKind.CallExpression);
      if (!call) throw new Error('Expected call expression');

      const result = getFirstArgumentOfKind(call, SyntaxKind.StringLiteral);
      expect(result).toBeDefined();
    });
  });
});

describe('identifier-resolver', () => {
  describe('resolveIdentifierInitializerNode', () => {
    test('resolves identifier to its initializer', () => {
      const project = createProject();
      const sourceFile = project.createSourceFile(
        'test.ts',
        `const myConst = "value"; const x = myConst;`
      );
      const varDecl = sourceFile.getVariableDeclaration('x');
      if (!varDecl) throw new Error('Expected variable declaration');

      const init = varDecl.getInitializer();
      if (!init) throw new Error('Expected initializer');

      const checker = project.getTypeChecker();
      const result = resolveIdentifierInitializerNode(init, checker);
      expect(result).toBeDefined();
    });
  });
});
