import type { Node } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import type { EnumLiteral } from './types.js';
import { unwrapNode } from './unwrap.js';

const BOOLEAN_ENUM_LENGTH = 2;

const isLiteralKind = (kind: SyntaxKind): boolean =>
  kind === SyntaxKind.StringLiteral ||
  kind === SyntaxKind.NumericLiteral ||
  kind === SyntaxKind.NoSubstitutionTemplateLiteral ||
  kind === SyntaxKind.TrueKeyword ||
  kind === SyntaxKind.FalseKeyword;

export const isCollectionKind = (kind: SyntaxKind): boolean =>
  kind === SyntaxKind.ArrayLiteralExpression || kind === SyntaxKind.ObjectLiteralExpression;

const isEmptyValue = (value: unknown): boolean =>
  value === null || value === undefined || value === '' || value === 0 || value === false;

export const isLiteralNode = (node: Node): boolean => isLiteralKind(unwrapNode(node).getKind());

const isWrappedNode = (node: Node): boolean =>
  node.getKind() === SyntaxKind.AsExpression ||
  node.getKind() === SyntaxKind.TypeAssertionExpression ||
  node.getKind() === SyntaxKind.ParenthesizedExpression;

export function isBooleanEnumValues(values: readonly EnumLiteral[]): boolean {
  if (values.length !== BOOLEAN_ENUM_LENGTH) return false;
  if (new Set(values).size !== BOOLEAN_ENUM_LENGTH) return false;
  return values.every((v) => typeof v === 'boolean');
}
