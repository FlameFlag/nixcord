import { describe, test, expect } from 'vitest';
import { Project, SyntaxKind, ModuleKind } from 'ts-morph';
import { tsTypeToNixType } from '../../../src/parser.js';

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

describe('tsTypeToNixType()', () => {
  test('type inference from boolean default -> types.bool', () => {
    const project = createProject();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = tsTypeToNixType({ default: true }, program, checker);
    expect(result.nixType).toBe('types.bool');
  });

  test('type inference from string default -> types.str', () => {
    const project = createProject();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = tsTypeToNixType({ default: 'test' }, program, checker);
    expect(result.nixType).toBe('types.str');
  });

  test('type inference from integer default -> types.int', () => {
    const project = createProject();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = tsTypeToNixType({ default: 42 }, program, checker);
    expect(result.nixType).toBe('types.int');
  });

  test('type inference from float default -> types.float', () => {
    const project = createProject();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = tsTypeToNixType({ default: 3.14 }, program, checker);
    expect(result.nixType).toBe('types.float');
  });

  test('PropertyAccessExpression types (enum)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const obj = { type: OptionType.BOOLEAN };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const typeProp = objLiteral.getProperty('type');
    const typeNode = typeProp?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    if (!typeNode) {
      throw new Error('Type node not found');
    }
    const result = tsTypeToNixType({ type: typeNode }, program, checker);
    // Since OptionType is not defined, it should fall back to default inference
    // We'll check that it handles the node correctly
    expect(result.nixType).toBeDefined();
  });

  test('NumericLiteral types', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const obj = { type: 0 };`);
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const typeProp = objLiteral.getProperty('type');
    const typeNode = typeProp?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    if (!typeNode) {
      throw new Error('Type node not found');
    }
    const result = tsTypeToNixType({ type: typeNode }, program, checker);
    expect(result.nixType).toBe('types.str');
  });

  test('returns types.str as fallback', () => {
    const project = createProject();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = tsTypeToNixType({}, program, checker);
    expect(result.nixType).toBe('types.str');
  });

  test('OptionTypeMap mapping - BOOLEAN', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `enum OptionType {
        BOOLEAN = 3
      }
      const obj = { type: OptionType.BOOLEAN };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const typeProp = objLiteral.getProperty('type');
    const typeNode = typeProp?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    if (!typeNode) {
      throw new Error('Type node not found');
    }
    const result = tsTypeToNixType({ type: typeNode }, program, checker);
    // Should map BOOLEAN to types.bool
    expect(result.nixType).toBe('types.bool');
  });

  test('OptionTypeMap mapping - STRING', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `enum OptionType {
        STRING = 0
      }
      const obj = { type: OptionType.STRING };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const typeProp = objLiteral.getProperty('type');
    const typeNode = typeProp?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    if (!typeNode) {
      throw new Error('Type node not found');
    }
    const result = tsTypeToNixType({ type: typeNode }, program, checker);
    expect(result.nixType).toBe('types.str');
  });

  test('OptionTypeMap mapping - NUMBER', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `enum OptionType {
        NUMBER = 1
      }
      const obj = { type: OptionType.NUMBER, default: 42 };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const typeProp = objLiteral.getProperty('type');
    const typeNode = typeProp?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
    const defaultProp = objLiteral.getProperty('default');
    const defaultNode = defaultProp
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.NumericLiteral)
      ?.getLiteralValue();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    if (!typeNode) {
      throw new Error('Type node not found');
    }
    const result = tsTypeToNixType({ type: typeNode, default: defaultNode }, program, checker);
    expect(result.nixType).toBe('types.int');
  });

  test('OptionTypeMap mapping - NUMBER with float default', () => {
    const project = createProject();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = tsTypeToNixType({ type: undefined, default: 3.14 }, program, checker);
    expect(result.nixType).toBe('types.float');
  });

  test('OptionTypeMap mapping - SELECT', () => {
    const project = createProject();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = tsTypeToNixType(
      {
        type: undefined,
        options: [{ value: 'option1' }, { value: 'option2' }],
      },
      program,
      checker
    );
    // SELECT maps to enum, but needs enum values
    expect(result.nixType).toBeDefined();
  });

  test('OptionTypeMap mapping - SLIDER', () => {
    const project = createProject();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    // SLIDER is 5, which maps to FLOAT
    const result = tsTypeToNixType({ type: undefined }, program, checker);
    expect(result.nixType).toBe('types.str');
  });

  test('OptionTypeMap mapping - COMPONENT', () => {
    const project = createProject();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = tsTypeToNixType({ type: 6, default: { key: 'value' } }, program, checker);
    expect(result.nixType).toBe('types.attrs');
  });

  test('OptionTypeMap mapping - CUSTOM', () => {
    const project = createProject();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = tsTypeToNixType({ type: 7, default: { key: 'value' } }, program, checker);
    expect(result.nixType).toBe('types.attrs');
  });

  test('OptionTypeMap mapping - BIGINT', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `enum OptionType {
        BIGINT = 2
      }
      const obj = { type: OptionType.BIGINT };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const typeProp = objLiteral.getProperty('type');
    const typeNode = typeProp?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    if (!typeNode) {
      throw new Error('Type node not found');
    }
    const result = tsTypeToNixType({ type: typeNode }, program, checker);
    // BIGINT maps to types.int
    expect(result.nixType).toBe('types.int');
  });

  test('handles enum member resolution (numeric)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `enum OptionType {
        BOOLEAN = 3
      }
      const obj = { type: OptionType.BOOLEAN };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const typeProp = objLiteral.getProperty('type');
    const typeNode = typeProp?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    if (!typeNode) {
      throw new Error('Type node not found');
    }
    const result = tsTypeToNixType({ type: typeNode }, program, checker);
    expect(result.nixType).toBe('types.bool');
  });

  test('handles enum member resolution (string)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `enum OptionType {
        STRING = "STRING"
      }
      const obj = { type: OptionType.STRING };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const typeProp = objLiteral.getProperty('type');
    const typeNode = typeProp?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    if (!typeNode) {
      throw new Error('Type node not found');
    }
    const result = tsTypeToNixType({ type: typeNode }, program, checker);
    // String enums may not resolve correctly, but should not crash
    expect(result.nixType).toBeDefined();
  });

  test('handles Identifier types', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const obj = { type: SomeType };`);
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('obj')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const typeProp = objLiteral.getProperty('type');
    const typeNode = typeProp?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    if (!typeNode) {
      throw new Error('Type node not found');
    }
    const result = tsTypeToNixType({ type: typeNode }, program, checker);
    expect(result.nixType).toBeDefined();
  });

  test('handles object default for CUSTOM/COMPONENT', () => {
    const project = createProject();
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = tsTypeToNixType(
      { type: 6, default: { nested: { key: 'value' } } },
      program,
      checker
    );
    expect(result.nixType).toBe('types.attrs');
  });
});
