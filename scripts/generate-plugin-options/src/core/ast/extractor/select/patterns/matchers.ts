import type { TypeChecker, Node, PropertyAccessExpression, Identifier, CallExpression, ArrayLiteralExpression } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { asKind, getFirstArgumentOfKind } from '../../../utils/node-helpers.js';
import { METHOD_NAME_MAP, METHOD_NAME_KEYS, METHOD_NAME_VALUES, METHOD_NAME_FROM, GLOBAL_ARRAY_NAME } from '../../constants.js';

export const isArrayLiteral = (node: Node): node is ArrayLiteralExpression =>
  node.getKind() === SyntaxKind.ArrayLiteralExpression;

export const isCallExpression = (node: Node): node is CallExpression =>
  node.getKind() === SyntaxKind.CallExpression;

export const isMapCall = (call: CallExpression): boolean => {
  const expr = call.getExpression();
  return expr.getKind() === SyntaxKind.PropertyAccessExpression &&
    expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName() === METHOD_NAME_MAP;
};

export const isArrayMapCall = (call: CallExpression): boolean =>
  isMapCall(call) && isArrayLiteral(call.getExpression().asKindOrThrow(SyntaxKind.PropertyAccessExpression).getExpression());

export const isArrayFromCall = (call: Node): boolean => {
  if (call.getKind() !== SyntaxKind.CallExpression) return false;
  const propAccess = asKind<PropertyAccessExpression>(call.asKindOrThrow(SyntaxKind.CallExpression).getExpression(), SyntaxKind.PropertyAccessExpression).unwrapOr(undefined);
  return propAccess?.getExpression()?.getKind() === SyntaxKind.Identifier &&
    propAccess.getExpression().asKindOrThrow(SyntaxKind.Identifier).getText() === GLOBAL_ARRAY_NAME &&
    propAccess.getName() === METHOD_NAME_FROM;
};

export const isObjectKeysCall = (call: CallExpression): boolean =>
  call.getExpression().getKind() === SyntaxKind.PropertyAccessExpression &&
  call.getExpression().asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName() === METHOD_NAME_KEYS;

export const isObjectValuesCall = (call: CallExpression): boolean =>
  call.getExpression().getKind() === SyntaxKind.PropertyAccessExpression &&
  call.getExpression().asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName() === METHOD_NAME_VALUES;

export const isObjectKeysMapCall = (call: CallExpression): boolean => {
  if (!isMapCall(call)) return false;
  const target = call.getExpression().asKindOrThrow(SyntaxKind.PropertyAccessExpression).getExpression();
  return target.getKind() === SyntaxKind.CallExpression && isObjectKeysCall(target.asKindOrThrow(SyntaxKind.CallExpression));
};

export const isObjectValuesMapCall = (call: CallExpression): boolean => {
  if (!isMapCall(call)) return false;
  const target = call.getExpression().asKindOrThrow(SyntaxKind.PropertyAccessExpression).getExpression();
  return target.getKind() === SyntaxKind.CallExpression && isObjectValuesCall(target.asKindOrThrow(SyntaxKind.CallExpression));
};

export const getObjectMethodTargetIdentifier = (call: CallExpression): Identifier | undefined =>
  getFirstArgumentOfKind<Identifier>(call, SyntaxKind.Identifier).unwrapOr(undefined);
