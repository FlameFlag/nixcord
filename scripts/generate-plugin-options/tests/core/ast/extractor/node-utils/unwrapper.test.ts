import { describe, test, expect } from 'vitest';
import { Project, SyntaxKind, ModuleKind } from 'ts-morph';
import { unwrapNode } from '../../../../../src/core/ast/foundation.js';

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

describe('unwrapNode()', () => {
  test('unwraps AsExpression', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const x = "test" as string;`);
    const varDecl = sourceFile.getVariableDeclarationOrThrow('x');
    const initializer = varDecl.getInitializer();
    expect(initializer?.getKind()).toBe(SyntaxKind.AsExpression);
    if (initializer) {
      const unwrapped = unwrapNode(initializer);
      expect(unwrapped.getKind()).toBe(SyntaxKind.StringLiteral);
    }
  });

  test('unwraps ParenthesizedExpression', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const x = (42);`);
    const varDecl = sourceFile.getVariableDeclarationOrThrow('x');
    const initializer = varDecl.getInitializer();
    expect(initializer?.getKind()).toBe(SyntaxKind.ParenthesizedExpression);
    if (initializer) {
      const unwrapped = unwrapNode(initializer);
      expect(unwrapped.getKind()).toBe(SyntaxKind.NumericLiteral);
    }
  });

  test('unwraps TypeAssertionExpression', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const x = <number>42;`);
    const varDecl = sourceFile.getVariableDeclarationOrThrow('x');
    const initializer = varDecl.getInitializer();
    expect(initializer?.getKind()).toBe(SyntaxKind.TypeAssertionExpression);
    if (initializer) {
      const unwrapped = unwrapNode(initializer);
      expect(unwrapped.getKind()).toBe(SyntaxKind.NumericLiteral);
    }
  });

  test('handles nested wrappers', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const x = (("test" as string) as string);`
    );
    const varDecl = sourceFile.getVariableDeclarationOrThrow('x');
    const initializer = varDecl.getInitializer();
    if (initializer) {
      const unwrapped = unwrapNode(initializer);
      expect(unwrapped.getKind()).toBe(SyntaxKind.StringLiteral);
    }
  });

  test('handles deeply nested wrappers', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const x = ((((42 as number) as any) as number) as number);`
    );
    const varDecl = sourceFile.getVariableDeclarationOrThrow('x');
    const initializer = varDecl.getInitializer();
    if (initializer) {
      const unwrapped = unwrapNode(initializer);
      expect(unwrapped.getKind()).toBe(SyntaxKind.NumericLiteral);
    }
  });

  test('returns node as-is if not a wrapper', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const x = 42;`);
    const varDecl = sourceFile.getVariableDeclarationOrThrow('x');
    const initializer = varDecl.getInitializer();
    if (initializer) {
      const unwrapped = unwrapNode(initializer);
      expect(unwrapped).toBe(initializer);
    }
  });
});
