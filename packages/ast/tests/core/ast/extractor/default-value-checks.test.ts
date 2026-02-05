import { describe, test, expect } from 'vitest';
import { Project, ModuleKind, SyntaxKind } from 'ts-morph';
import {
  hasStringArrayDefault,
  hasObjectArrayDefault,
  hasEmptyArrayWithTypeAnnotation,
  resolveIdentifierArrayDefault,
} from '../../../../src/extractor/default-value-checks/index.js';

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

let fileId = 0;

function getOptionLiteral(code: string, varName = 'option') {
  const project = createProject();
  const sourceFile = project.createSourceFile(`default-value-checks-${fileId++}.ts`, code, {
    overwrite: true,
  });
  const literal = sourceFile
    .getVariableDeclarationOrThrow(varName)
    .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  const checker = project.getTypeChecker();
  return { literal, checker };
}

describe('default value structural helpers', () => {
  test('hasStringArrayDefault detects inline literals and identifiers', () => {
    const inline = getOptionLiteral(`const option = { default: ["alpha", "beta"] };`).literal;
    expect(hasStringArrayDefault(inline)).toBe(true);

    const identifier = getOptionLiteral(
      `
      const PRESETS = ["one", "two"];
      const option = { default: PRESETS };
      `
    ).literal;
    expect(hasStringArrayDefault(identifier)).toBe(true);

    const notStringArray = getOptionLiteral(`const option = { default: [1, 2] };`).literal;
    expect(hasStringArrayDefault(notStringArray)).toBe(false);
  });

  test('hasObjectArrayDefault handles call expressions and identifier resolution', () => {
    const { literal: fromCall, checker: callChecker } = getOptionLiteral(`
      const makeRules = () => [{ label: "one" }, { label: "two" }];
      const option = { default: makeRules() };
    `);
    expect(hasObjectArrayDefault(fromCall, callChecker)).toBe(true);

    const { literal: fromIdentifier, checker } = getOptionLiteral(`
      const RAW = [{ id: 1 }, { id: 2 }];
      const option = { default: RAW };
    `);
    expect(hasObjectArrayDefault(fromIdentifier, checker)).toBe(true);

    const { literal: notObjects, checker: notChecker } = getOptionLiteral(`
      const NUMS = [1, 2, 3];
      const option = { default: NUMS };
    `);
    expect(hasObjectArrayDefault(notObjects, notChecker)).toBe(false);
  });

  test('hasEmptyArrayWithTypeAnnotation recognises typed arrays and helper factories', () => {
    const typed = getOptionLiteral(`
      type Rule = { id: string };
      const option = { default: [] as Rule[] };
    `).literal;
    expect(hasEmptyArrayWithTypeAnnotation(typed)).toBe(true);

    const fromFactory = getOptionLiteral(`
      const makeEmptyRuleArray = () => [];
      const option = { default: makeEmptyRuleArray() };
    `).literal;
    expect(hasEmptyArrayWithTypeAnnotation(fromFactory)).toBe(true);

    const withoutAnnotation = getOptionLiteral(`const option = { default: [] };`).literal;
    expect(hasEmptyArrayWithTypeAnnotation(withoutAnnotation)).toBe(false);
  });

  test('resolveIdentifierArrayDefault inspects literals and casts', () => {
    const literal = getOptionLiteral(`
      const IDS = ["a", "b", "c"];
      const option = { default: IDS };
    `).literal;
    expect(resolveIdentifierArrayDefault(literal)).toBe(true);

    const cast = getOptionLiteral(`
      const IDS = [] as string[];
      const option = { default: IDS };
    `).literal;
    expect(resolveIdentifierArrayDefault(cast)).toBe(true);

    const invalid = getOptionLiteral(`
      const IDS = [1, 2];
      const option = { default: IDS };
    `).literal;
    expect(resolveIdentifierArrayDefault(invalid)).toBe(false);
  }, 40000);
});
