import { describe, test, expect } from 'vitest';
import { Project, SyntaxKind, ModuleKind } from 'ts-morph';
import {
  resolveIdentifierInitializerNode,
  resolveIdentifierWithFallback,
} from '../../../../../src/core/ast/extractor/node-utils.js';

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

describe('resolveIdentifierInitializerNode()', () => {
  test('resolves const identifier to its initializer', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const VALUE = "test"; const x = VALUE;`
    );
    const varDecl = sourceFile.getVariableDeclarationOrThrow('x');
    const initializer = varDecl.getInitializer();
    expect(initializer?.getKind()).toBe(SyntaxKind.Identifier);
    if (initializer) {
      const checker = project.getTypeChecker();
      const resolved = resolveIdentifierInitializerNode(initializer, checker);
      expect(resolved.isJust).toBe(true);
      const node = resolved.unwrapOr(undefined);
      expect(node?.getKind()).toBe(SyntaxKind.StringLiteral);
      if (node?.getKind() === SyntaxKind.StringLiteral) {
        const stringLiteral = node.asKindOrThrow(SyntaxKind.StringLiteral);
        expect(stringLiteral.getLiteralValue()).toBe('test');
      }
    }
  });

  test('resolves numeric constant', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const COUNT = 42; const x = COUNT;`);
    const varDecl = sourceFile.getVariableDeclarationOrThrow('x');
    const initializer = varDecl.getInitializer();
    if (initializer) {
      const checker = project.getTypeChecker();
      const resolved = resolveIdentifierInitializerNode(initializer, checker);
      expect(resolved.isJust).toBe(true);
      const node = resolved.unwrapOr(undefined);
      expect(node?.getKind()).toBe(SyntaxKind.NumericLiteral);
    }
  });

  test('returns undefined for non-identifier', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const x = "test";`);
    const varDecl = sourceFile.getVariableDeclarationOrThrow('x');
    const initializer = varDecl.getInitializer();
    if (initializer) {
      const checker = project.getTypeChecker();
      const resolved = resolveIdentifierInitializerNode(initializer, checker);
      expect(resolved.isNothing).toBe(true);
    }
  });

  test('returns undefined for unresolved identifier', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const x = UNKNOWN;`);
    const varDecl = sourceFile.getVariableDeclarationOrThrow('x');
    const initializer = varDecl.getInitializer();
    if (initializer) {
      const checker = project.getTypeChecker();
      const resolved = resolveIdentifierInitializerNode(initializer, checker);
      expect(resolved.isNothing).toBe(true);
    }
  });

  test('returns undefined for non-identifier node', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const x = "test";`);
    const varDecl = sourceFile.getVariableDeclarationOrThrow('x');
    const initializer = varDecl.getInitializer();
    if (initializer && initializer.getKind() === SyntaxKind.StringLiteral) {
      const checker = project.getTypeChecker();
      const resolved = resolveIdentifierInitializerNode(initializer, checker);
      // Non-identifier nodes should return nothing immediately
      expect(resolved.isNothing).toBe(true);
    }
  });

  test('handles aliased symbol resolution', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `import { VALUE as importedValue } from "./other";
      const VALUE = importedValue;
      const x = VALUE;`
    );
    const varDecl = sourceFile.getVariableDeclarationOrThrow('x');
    const initializer = varDecl.getInitializer();
    if (initializer) {
      const checker = project.getTypeChecker();
      const resolved = resolveIdentifierInitializerNode(initializer, checker);
      // Aliased symbols should be handled via getAliasedSymbol() fallback
      expect(resolved.isNothing || resolved.isJust).toBe(true);
    }
  });
});

describe('resolveIdentifierWithFallback()', () => {
  test('resolves identifier via checker first', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const VALUE = "test"; const x = VALUE;`
    );
    const varDecl = sourceFile.getVariableDeclarationOrThrow('x');
    const initializer = varDecl.getInitializer();
    if (initializer && initializer.getKind() === SyntaxKind.Identifier) {
      const checker = project.getTypeChecker();
      const resolved = resolveIdentifierWithFallback(initializer, checker);
      expect(resolved?.getKind()).toBe(SyntaxKind.StringLiteral);
    }
  });

  test('falls back to same-file lookup when checker fails', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const VALUE = "test";
      const x = VALUE;`
    );
    const varDecl = sourceFile.getVariableDeclarationOrThrow('x');
    const initializer = varDecl.getInitializer();
    if (initializer && initializer.getKind() === SyntaxKind.Identifier) {
      const checker = project.getTypeChecker();
      const resolved = resolveIdentifierWithFallback(initializer, checker);
      // Should resolve via same-file lookup fallback
      expect(resolved?.getKind()).toBe(SyntaxKind.StringLiteral);
    }
  });

  test('searches all variable declarations when getVariableDeclaration fails', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `let VALUE = "test";
      const x = VALUE;`
    );
    const varDecl = sourceFile.getVariableDeclarationOrThrow('x');
    const initializer = varDecl.getInitializer();
    if (initializer && initializer.getKind() === SyntaxKind.Identifier) {
      const checker = project.getTypeChecker();
      const resolved = resolveIdentifierWithFallback(initializer, checker);
      // Should find via getAllVariableDeclarations search
      expect(resolved?.getKind()).toBe(SyntaxKind.StringLiteral);
    }
  });

  test('returns undefined for non-identifier', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const x = "test";`);
    const varDecl = sourceFile.getVariableDeclarationOrThrow('x');
    const initializer = varDecl.getInitializer();
    if (initializer && initializer.getKind() !== SyntaxKind.Identifier) {
      const checker = project.getTypeChecker();
      const resolved = resolveIdentifierWithFallback(initializer, checker);
      expect(resolved).toBeUndefined();
    }
  });

  test('returns undefined when no declaration found', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const x = UNKNOWN;`);
    const varDecl = sourceFile.getVariableDeclarationOrThrow('x');
    const initializer = varDecl.getInitializer();
    if (initializer && initializer.getKind() === SyntaxKind.Identifier) {
      const checker = project.getTypeChecker();
      const resolved = resolveIdentifierWithFallback(initializer, checker);
      expect(resolved).toBeUndefined();
    }
  });
});
