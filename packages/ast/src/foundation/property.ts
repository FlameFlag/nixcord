import type {
  Node,
  ObjectLiteralExpression,
  PropertyAssignment,
  CallExpression,
  PropertyAccessExpression,
  ArrayLiteralExpression,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';

export const typeMatches = (name: string, pattern: string): boolean =>
  name === pattern || name.includes(pattern);

export const asKind = <T extends Node>(node: Node, kind: SyntaxKind): T | undefined =>
  node.getKind() === kind ? (node as T) : undefined;

export const getPropertyAssignment = (
  obj: ObjectLiteralExpression,
  propName: string
): PropertyAssignment | undefined => {
  const prop = obj.getProperty(propName);
  if (prop !== undefined && prop.getKind() === SyntaxKind.PropertyAssignment) {
    return prop.asKindOrThrow(SyntaxKind.PropertyAssignment);
  }
  return undefined;
};

export const getPropertyInitializer = (
  obj: ObjectLiteralExpression,
  propName: string
): Node | undefined => {
  const prop = getPropertyAssignment(obj, propName);
  if (!prop) return undefined;
  return prop.getInitializer() as Node | undefined;
};

export const extractStringLiteralValue = (
  obj: ObjectLiteralExpression,
  propName: string
): string | undefined => {
  const init = getPropertyInitializer(obj, propName);
  if (!init) return undefined;
  switch (init.getKind()) {
    case SyntaxKind.StringLiteral:
      return init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();
    case SyntaxKind.NoSubstitutionTemplateLiteral:
      return init.asKindOrThrow(SyntaxKind.NoSubstitutionTemplateLiteral).getLiteralValue();
    default:
      return undefined;
  }
};

export const extractBooleanLiteralValue = (
  obj: ObjectLiteralExpression,
  propName: string
): boolean | undefined => {
  const init = getPropertyInitializer(obj, propName);
  if (!init) return undefined;
  switch (init.getKind()) {
    case SyntaxKind.TrueKeyword:
      return true;
    case SyntaxKind.FalseKeyword:
      return false;
    default:
      return undefined;
  }
};

export const getPropertyName = (prop: PropertyAssignment): string | undefined => {
  const nameNode = prop.getNameNode();
  switch (nameNode.getKind()) {
    case SyntaxKind.StringLiteral:
      return nameNode.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();
    case SyntaxKind.Identifier:
      return nameNode.getText().replace(/['"]/g, '');
    default:
      return undefined;
  }
};

export function* iteratePropertyAssignments(
  obj: ObjectLiteralExpression
): Generator<PropertyAssignment> {
  for (const prop of obj.getProperties()) {
    if (prop.getKind() === SyntaxKind.PropertyAssignment) {
      yield prop.asKindOrThrow(SyntaxKind.PropertyAssignment);
    }
  }
}

export const hasProperty = (obj: ObjectLiteralExpression, propName: string): boolean =>
  getPropertyAssignment(obj, propName) !== undefined;

export const isMethodCall = (
  call: CallExpression,
  methodName: string
): PropertyAccessExpression | undefined => {
  const expr = call.getExpression();
  const propAccess = asKind<PropertyAccessExpression>(expr, SyntaxKind.PropertyAccessExpression);
  if (!propAccess) return undefined;
  return propAccess.getName() === methodName ? propAccess : undefined;
};

export const getFirstArgumentOfKind = <T extends Node>(
  call: CallExpression,
  kind: SyntaxKind
): T | undefined => {
  const args = call.getArguments();
  const firstArg = args[0];
  return firstArg ? asKind<T>(firstArg, kind) : undefined;
};

export const isArrayOf = (arr: ArrayLiteralExpression, kind: SyntaxKind): boolean =>
  arr.getElements().every((el) => el.getKind() === kind);

export const isArrayOfStringLiterals = (arr: ArrayLiteralExpression): boolean =>
  isArrayOf(arr, SyntaxKind.StringLiteral);

export const isArrayOfObjectLiterals = (arr: ArrayLiteralExpression): boolean =>
  isArrayOf(arr, SyntaxKind.ObjectLiteralExpression);

export const getPropertyAssignments = (obj: ObjectLiteralExpression): PropertyAssignment[] =>
  Array.from(iteratePropertyAssignments(obj));
