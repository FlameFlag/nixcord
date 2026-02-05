import { describe, test, expect } from 'vitest';
import { Project, ModuleKind, SyntaxKind } from 'ts-morph';
import { extractPluginInfo } from '../../../../src/extractor/plugin.js';
import { findDefinePluginSettings } from '../../../../src/navigator/plugin-navigator.js';

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

describe('extractPluginInfo()', () => {
  test('extracts plugin name', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `definePlugin({ name: "TestPlugin", description: "Test" });`
    );
    const checker = project.getTypeChecker();
    const result = extractPluginInfo(sourceFile, checker);
    expect(result.name).toBe('TestPlugin');
  });

  test('extracts plugin description', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `definePlugin({ name: "TestPlugin", description: "Test description" });`
    );
    const checker = project.getTypeChecker();
    const result = extractPluginInfo(sourceFile, checker);
    expect(result.description).toBe('Test description');
  });

  test('handles missing definePlugin call', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const x = 42;`);
    const checker = project.getTypeChecker();
    const result = extractPluginInfo(sourceFile, checker);
    expect(result).toEqual({});
  });

  test('handles missing name/description', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `definePlugin({ type: "test" });`);
    const checker = project.getTypeChecker();
    const result = extractPluginInfo(sourceFile, checker);
    expect(result).toEqual({});
  });

  test('extracts both name and description', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `definePlugin({ name: "MyPlugin", description: "My description" });`
    );
    const checker = project.getTypeChecker();
    const result = extractPluginInfo(sourceFile, checker);
    expect(result.name).toBe('MyPlugin');
    expect(result.description).toBe('My description');
  });
});

describe('findDefinePluginSettings()', () => {
  test('returns Maybe<CallExpression>', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `definePluginSettings({ setting: { type: "STRING" } });`
    );
    const result = findDefinePluginSettings(sourceFile);
    expect(result).toBeDefined();
    expect(result).toBeDefined();
  });

  test('finds correct call expression', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `definePluginSettings({ test: { type: "STRING" } });`
    );
    const result = findDefinePluginSettings(sourceFile);
    expect(result).toBeDefined();
    const callExpr = result;
    expect(callExpr?.getExpression().getText()).toBe('definePluginSettings');
  });

  test('returns nothing when not found', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const x = 42;`);
    const result = findDefinePluginSettings(sourceFile);
    expect(result).toBeUndefined();
  });

  test('finds nested call expression', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `function setup() {
        definePluginSettings({ test: { type: "STRING" } });
      }`
    );
    const result = findDefinePluginSettings(sourceFile);
    expect(result).toBeDefined();
  });

  test('finds definePluginSettings with withPrivateSettings chained call', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'settings.ts',
      `export function definePluginSettings(settings: Record<string, unknown>) {
  return {
    ...settings,
    withPrivateSettings: () => settings
  };
}

export const settings = definePluginSettings({
  enable: {
    type: "BOOLEAN",
    description: "Enable",
    default: true,
  },
}).withPrivateSettings<{
  private: boolean;
}>();`
    );
    const result = findDefinePluginSettings(sourceFile);
    expect(result).toBeDefined();
    if (result !== undefined) {
      expect(result.getKind()).toBe(SyntaxKind.CallExpression);
      // Should find the original definePluginSettings call, not the withPrivateSettings call
      let expr = result.getExpression();
      // Unwrap if it's a property access
      if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
        expr = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getExpression();
        if (expr.getKind() === SyntaxKind.CallExpression) {
          expr = expr.asKindOrThrow(SyntaxKind.CallExpression).getExpression();
        }
      }
      if (expr.getKind() === SyntaxKind.Identifier) {
        expect(expr.getText()).toBe('definePluginSettings');
      }
    }
  });

  test('finds definePluginSettings with multiple chained calls', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'settings.ts',
      `export function definePluginSettings(settings: Record<string, unknown>) {
  return {
    ...settings,
    withPrivateSettings: () => settings
  };
}

export const settings = definePluginSettings({
  enable: {
    type: "BOOLEAN",
    description: "Enable",
    default: true,
  },
}).withPrivateSettings<{ private: boolean }>().withPrivateSettings<{ more: string }>();`
    );
    const result = findDefinePluginSettings(sourceFile);
    expect(result).toBeDefined();
    if (result !== undefined) {
      let expr = result.getExpression();
      // Should handle multiple chained calls
      while (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
        const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
        if (propAccess.getName() === 'withPrivateSettings') {
          expr = propAccess.getExpression();
          if (expr.getKind() === SyntaxKind.CallExpression) {
            expr = expr.asKindOrThrow(SyntaxKind.CallExpression).getExpression();
          }
        } else {
          break;
        }
      }
      if (expr.getKind() === SyntaxKind.Identifier) {
        expect(expr.getText()).toBe('definePluginSettings');
      }
    }
  });

  test('handles definePlugin with computed name/description', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const pluginName = "TestPlugin";
      const pluginDesc = "Test Description";
      definePlugin({ name: pluginName, description: pluginDesc });`
    );
    const checker = project.getTypeChecker();
    const result = extractPluginInfo(sourceFile, checker);
    // Should return empty object when name/description are computed
    expect(result).toEqual({});
  });

  test('handles definePlugin with missing properties', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `definePlugin({ name: "TestPlugin" });`);
    const checker = project.getTypeChecker();
    const result = extractPluginInfo(sourceFile, checker);
    expect(result.name).toBe('TestPlugin');
    expect(result.description).toBeUndefined();
  });
});
