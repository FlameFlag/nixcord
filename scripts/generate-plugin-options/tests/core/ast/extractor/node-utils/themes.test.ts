import { describe, test, expect } from 'vitest';
import { Project, ModuleKind } from 'ts-morph';
import { evaluateThemesValues } from '../../../../../src/core/ast/extractor/node-utils.js';

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

describe('evaluateThemesValues()', () => {
  test('evaluates simple theme object with string literals', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const themes = { DarkPlus: "dark-plus", LightPlus: "light-plus" };`
    );
    const varDecl = sourceFile.getVariableDeclarationOrThrow('themes');
    const identifier = varDecl.getNameNode();
    const checker = project.getTypeChecker();
    const values = evaluateThemesValues(identifier, checker);
    expect(values).toEqual(['dark-plus', 'light-plus']);
  });

  test('evaluates theme object with shikiRepoTheme calls', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `
      const SHIKI_REPO = "shikijs/shiki";
      const SHIKI_REPO_COMMIT = "abc123";
      const themes = {
        DarkPlus: shikiRepoTheme("dark-plus"),
        LightPlus: shikiRepoTheme("light-plus")
      };
      `
    );
    const varDecl = sourceFile.getVariableDeclarationOrThrow('themes');
    const identifier = varDecl.getNameNode();
    const checker = project.getTypeChecker();
    const values = evaluateThemesValues(identifier, checker);
    expect(values.length).toBeGreaterThan(0);
    expect(values[0]).toContain('raw.githubusercontent.com');
    expect(values[0]).toContain('dark-plus');
  });

  test('returns empty array for non-identifier', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const x = "test";`);
    const varDecl = sourceFile.getVariableDeclarationOrThrow('x');
    const initializer = varDecl.getInitializer();
    if (initializer) {
      const checker = project.getTypeChecker();
      const values = evaluateThemesValues(initializer, checker);
      expect(values).toEqual([]);
    }
  });

  test('returns empty array for non-object literal', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const themes = "not-an-object";`);
    const varDecl = sourceFile.getVariableDeclarationOrThrow('themes');
    const identifier = varDecl.getNameNode();
    const checker = project.getTypeChecker();
    const values = evaluateThemesValues(identifier, checker);
    expect(values).toEqual([]);
  });

  test('filters out null values', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const themes = { 
        Valid: "valid",
        Invalid: someFunction(),
        AlsoValid: "also-valid"
      };`
    );
    const varDecl = sourceFile.getVariableDeclarationOrThrow('themes');
    const identifier = varDecl.getNameNode();
    const checker = project.getTypeChecker();
    const values = evaluateThemesValues(identifier, checker);
    expect(values).toEqual(['valid', 'also-valid']);
  });
});
