import { SyntaxKind } from 'ts-morph';
import { describe, expect, test } from 'vitest';
import { unwrapNode } from '../../../../../src/foundation/index.js';
import { createProject } from '../../../../helpers/test-utils.js';

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
