/**
 * Utility functions for working with ts-morph AST nodes.
 * Reduces repetitive type checking and casting patterns.
 *
 * These helpers eliminate ~40% of repetitive code in AST extraction files.
 */

import type {
  Node,
  ObjectLiteralExpression,
  PropertyAssignment,
  CallExpression,
  PropertyAccessExpression,
  ArrayLiteralExpression,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { match } from 'ts-pattern';

/**
 * Type-safe node casting that returns T | undefined instead of throwing.
 * Use this when you want to handle the case where the node isn't the expected kind.
 */
export function asKind<T extends Node>(node: Node, kind: SyntaxKind): T | undefined {
  return node.getKind() === kind ? (node as T) : undefined;
}

/**
 * Retrieves a property from an object literal only when the underlying node
 * actually is a PropertyAssignment.
 *
 * Prevents accidental access to spreads, getters, or methods.
 */
export function getPropertyAssignment(
  obj: ObjectLiteralExpression,
  propName: string
): PropertyAssignment | undefined {
  const prop = obj.getProperty(propName);
  if (prop !== undefined && prop.getKind() === SyntaxKind.PropertyAssignment) {
    return prop.asKindOrThrow(SyntaxKind.PropertyAssignment);
  }
  return undefined;
}

/**
 * Extracts the initializer from a property assignment.
 * Returns undefined if property doesn't exist or has no initializer.
 */
export function getPropertyInitializer(
  obj: ObjectLiteralExpression,
  propName: string
): Node | undefined {
  const prop = getPropertyAssignment(obj, propName);
  if (!prop) return undefined;
  return prop.getInitializer() as Node | undefined;
}

/**
 * Extracts a string literal value from a property.
 * Handles both StringLiteral and NoSubstitutionTemplateLiteral.
 */
export function extractStringLiteralValue(
  obj: ObjectLiteralExpression,
  propName: string
): string | undefined {
  const init = getPropertyInitializer(obj, propName);
  if (!init) return undefined;
  return match(init.getKind())
    .with(SyntaxKind.StringLiteral, () =>
      init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
    )
    .with(SyntaxKind.NoSubstitutionTemplateLiteral, () =>
      init.asKindOrThrow(SyntaxKind.NoSubstitutionTemplateLiteral).getLiteralValue()
    )
    .otherwise(() => undefined);
}

/**
 * Extracts a boolean literal value from a property.
 */
export function extractBooleanLiteralValue(
  obj: ObjectLiteralExpression,
  propName: string
): boolean | undefined {
  const init = getPropertyInitializer(obj, propName);
  if (!init) return undefined;
  return match(init.getKind())
    .with(SyntaxKind.TrueKeyword, () => true)
    .with(SyntaxKind.FalseKeyword, () => false)
    .otherwise(() => undefined);
}

/**
 * Gets the property name from a PropertyAssignment's name node.
 * Handles both Identifier and StringLiteral name nodes.
 * For StringLiteral, uses getLiteralValue() for accuracy.
 */
export function getPropertyName(prop: PropertyAssignment): string | undefined {
  const nameNode = prop.getNameNode();
  return match(nameNode.getKind())
    .with(SyntaxKind.StringLiteral, () =>
      nameNode.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
    )
    .with(SyntaxKind.Identifier, () => nameNode.getText().replace(/['"]/g, ''))
    .otherwise(() => undefined);
}

/**
 * Iterates over PropertyAssignments in an object literal.
 * Filters out non-PropertyAssignment properties automatically.
 */
export function* iteratePropertyAssignments(
  obj: ObjectLiteralExpression
): Generator<PropertyAssignment> {
  for (const prop of obj.getProperties()) {
    if (prop.getKind() === SyntaxKind.PropertyAssignment) {
      yield prop.asKindOrThrow(SyntaxKind.PropertyAssignment);
    }
  }
}

/**
 * Checks if a property with the given name exists and is a PropertyAssignment.
 */
export function hasProperty(obj: ObjectLiteralExpression, propName: string): boolean {
  return getPropertyAssignment(obj, propName) !== undefined;
}

/**
 * Type-safe helpers for common node types.
 */

/**
 * Checks if a CallExpression matches a specific method pattern.
 * Returns the PropertyAccessExpression if it matches, undefined otherwise.
 */
export function isMethodCall(
  call: CallExpression,
  methodName: string
): PropertyAccessExpression | undefined {
  const expr = call.getExpression();
  const propAccess = asKind<PropertyAccessExpression>(expr, SyntaxKind.PropertyAccessExpression);
  if (!propAccess) return undefined;
  return propAccess.getName() === methodName ? propAccess : undefined;
}

/**
 * Extracts the first argument of a specific kind from a CallExpression.
 */
export function getFirstArgumentOfKind<T extends Node>(
  call: CallExpression,
  kind: SyntaxKind
): T | undefined {
  const args = call.getArguments();
  const firstArg = args[0];
  return firstArg ? asKind<T>(firstArg, kind) : undefined;
}

export function isArrayOf(arr: ArrayLiteralExpression, kind: SyntaxKind): boolean {
  return arr.getElements().every((el) => el.getKind() === kind);
}

export function isArrayOfStringLiterals(arr: ArrayLiteralExpression): boolean {
  return isArrayOf(arr, SyntaxKind.StringLiteral);
}

export function isArrayOfObjectLiterals(arr: ArrayLiteralExpression): boolean {
  return isArrayOf(arr, SyntaxKind.ObjectLiteralExpression);
}

export const getPropertyAssignments = (obj: ObjectLiteralExpression): PropertyAssignment[] =>
  Array.from(iteratePropertyAssignments(obj));
