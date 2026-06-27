import type {
  ArrayLiteralExpression,
  CallExpression,
  Identifier,
  Node,
  TypeChecker,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { getFirstArgumentOfKind } from '../../../foundation/index.js';
import {
  GLOBAL_ARRAY_NAME,
  METHOD_NAME_FROM,
  METHOD_NAME_KEYS,
  METHOD_NAME_MAP,
  METHOD_NAME_VALUES,
} from '../../constants.js';

export const isArrayLiteral = (node: Node): node is ArrayLiteralExpression =>
  node.getKind() === SyntaxKind.ArrayLiteralExpression;

export const isCallExpression = (node: Node): node is CallExpression =>
  node.getKind() === SyntaxKind.CallExpression;

export const isMapCall = (call: CallExpression): boolean => {
  const expr = call.getExpression();
  return (
    expr.getKind() === SyntaxKind.PropertyAccessExpression &&
    expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName() === METHOD_NAME_MAP
  );
};

export const isArrayMapCall = (call: CallExpression): boolean =>
  isMapCall(call) &&
  isArrayLiteral(
    call.getExpression().asKindOrThrow(SyntaxKind.PropertyAccessExpression).getExpression()
  );

export const isArrayFromCall = (call: Node): boolean => {
  if (call.getKind() !== SyntaxKind.CallExpression) return false;
  const propAccess = call
    .asKindOrThrow(SyntaxKind.CallExpression)
    .getExpression()
    .asKind(SyntaxKind.PropertyAccessExpression);
  return (
    propAccess?.getExpression()?.getKind() === SyntaxKind.Identifier &&
    propAccess.getExpression().asKindOrThrow(SyntaxKind.Identifier).getText() ===
      GLOBAL_ARRAY_NAME &&
    propAccess.getName() === METHOD_NAME_FROM
  );
};

export const isObjectKeysCall = (call: CallExpression): boolean =>
  call.getExpression().getKind() === SyntaxKind.PropertyAccessExpression &&
  call.getExpression().asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName() ===
    METHOD_NAME_KEYS;

export const isObjectValuesCall = (call: CallExpression): boolean =>
  call.getExpression().getKind() === SyntaxKind.PropertyAccessExpression &&
  call.getExpression().asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName() ===
    METHOD_NAME_VALUES;

const isObjectMethodMapCall = (
  call: CallExpression,
  isObjectMethodCall: (call: CallExpression) => boolean
): boolean => {
  if (!isMapCall(call)) return false;
  const target = call
    .getExpression()
    .asKindOrThrow(SyntaxKind.PropertyAccessExpression)
    .getExpression();
  return (
    target.getKind() === SyntaxKind.CallExpression &&
    isObjectMethodCall(target.asKindOrThrow(SyntaxKind.CallExpression))
  );
};

export const isObjectKeysMapCall = (call: CallExpression): boolean =>
  isObjectMethodMapCall(call, isObjectKeysCall);

export const isObjectValuesMapCall = (call: CallExpression): boolean =>
  isObjectMethodMapCall(call, isObjectValuesCall);

export const getObjectMethodTargetIdentifier = (call: CallExpression): Identifier | undefined =>
  getFirstArgumentOfKind<Identifier>(call, SyntaxKind.Identifier);
