import { Ok } from '@nixcord/shared';
import type { Node, ObjectLiteralExpression, TypeChecker } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';

import {
  evaluate,
  getArrowFunctionBody,
  getPropertyAssignment,
  getPropertyInitializer,
  resolveIdentifierInitializerNode,
  unwrapNode,
} from '../../../foundation/index.js';
import { DEFAULT_PROPERTY, VALUE_PROPERTY } from '../../constants.js';
import { resolveEnumLikeValue } from '../../enum-resolver.js';
import type { SelectDefaultResult } from '../../types.js';

const extractDefaultFromArrowFunction = (
  args: Node[],
  obj: Node,
  checker: TypeChecker
): SelectDefaultResult => {
  if (args.length === 0) return Ok(undefined);

  const body = getArrowFunctionBody(args[0]);
  if (!body || body.getKind() !== SyntaxKind.ObjectLiteralExpression) {
    return Ok(undefined);
  }

  const bodyObj = body.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  const defProp = getPropertyAssignment(bodyObj, DEFAULT_PROPERTY);

  if (defProp && defProp.getInitializer()?.getKind() === SyntaxKind.TrueKeyword) {
    const valueInit = getPropertyInitializer(bodyObj, VALUE_PROPERTY);
    if (valueInit) {
      const valueVal = resolveEnumLikeValue(valueInit, checker);
      if (valueVal.ok) return Ok(valueVal.value);
    }
  }

  if (defProp && defProp.getInitializer()?.getKind() === SyntaxKind.BinaryExpression) {
    const bin = defProp.getInitializer()?.asKind(SyntaxKind.BinaryExpression);
    if (!bin) return Ok(undefined);

    const right = bin.getRight();
    const val = resolveEnumLikeValue(right, checker);
    if (val.ok) return Ok(val.value);

    const valueInit = getPropertyInitializer(bodyObj, VALUE_PROPERTY);
    if (!valueInit) return Ok(undefined);
    const valueVal = resolveEnumLikeValue(valueInit, checker);
    return valueVal.ok ? Ok(valueVal.value) : Ok(undefined);
  }

  if (defProp && defProp.getInitializer()?.getKind() === SyntaxKind.CallExpression) {
    const arrayExpr = obj.asKind(SyntaxKind.ArrayLiteralExpression);
    if (arrayExpr && arrayExpr.getElements().length > 0) {
      const firstEl = arrayExpr.getElements()[0];
      if (firstEl.getKind() === SyntaxKind.StringLiteral) {
        return Ok(firstEl.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue());
      }
      const val = resolveEnumLikeValue(firstEl, checker);
      if (val.ok) return Ok(val.value);
    }
  }

  return Ok(undefined);
};

const findDefaultInArrayLiteral = (
  elements: readonly Node[],
  checker: TypeChecker
): SelectDefaultResult => {
  const findDefaultInElement = (element: Node): SelectDefaultResult => {
    if (element.getKind() === SyntaxKind.ObjectLiteralExpression) {
      const obj = element.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
      const defaultProp = getPropertyAssignment(obj, DEFAULT_PROPERTY);

      if (!defaultProp || defaultProp.getInitializer()?.getKind() !== SyntaxKind.TrueKeyword) {
        return Ok(undefined);
      }

      const valueInit = getPropertyInitializer(obj, VALUE_PROPERTY);
      if (!valueInit) return Ok(undefined);

      const val = evaluate(valueInit, checker);
      return val.ok ? Ok(val.value) : Ok(undefined);
    }

    if (element.getKind() === SyntaxKind.SpreadElement) {
      const spread = element.asKindOrThrow(SyntaxKind.SpreadElement);
      const expr = spread.getExpression();

      if (expr.getKind() === SyntaxKind.Identifier) {
        const init = resolveIdentifierInitializerNode(expr, checker);
        if (init && init.getKind() === SyntaxKind.ArrayLiteralExpression) {
          return findDefaultInArrayLiteral(
            init.asKindOrThrow(SyntaxKind.ArrayLiteralExpression).getElements(),
            checker
          );
        }
      }
    }

    return Ok(undefined);
  };

  const firstDefault = elements.find((el) => {
    const result = findDefaultInElement(el);
    return result.ok && result.value !== undefined;
  });

  return firstDefault ? findDefaultInElement(firstDefault) : Ok(undefined);
};

const resolveFirstPropertyName = (node: Node, checker: TypeChecker): string | undefined => {
  const init = resolveIdentifierInitializerNode(node, checker);
  const resolvedObj =
    init && init.getKind() === SyntaxKind.ObjectLiteralExpression
      ? init.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
      : node
          .getSourceFile()
          .getVariableDeclaration(node.getText())
          ?.getInitializer()
          ?.asKind(SyntaxKind.ObjectLiteralExpression);

  if (!resolvedObj) return undefined;

  const firstProp = resolvedObj
    .getProperties()
    .find((p) => p.getKind() === SyntaxKind.PropertyAssignment);
  if (!firstProp) return undefined;

  const nameNode = firstProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getNameNode();
  return (
    nameNode.asKind(SyntaxKind.StringLiteral)?.getLiteralValue() ??
    firstProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getName()
  );
};

const extractDefaultFromObjectKeysMap = (
  targetCall: Node,
  mapArgs: Node[],
  checker: TypeChecker
): SelectDefaultResult => {
  const targetCallExpr = targetCall.asKind(SyntaxKind.CallExpression);
  if (!targetCallExpr) return Ok(undefined);

  const innerPropExpr = targetCallExpr.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
  if (innerPropExpr?.getName() !== 'keys') return Ok(undefined);

  const keysArgs = targetCallExpr.getArguments();
  if (keysArgs.length === 0) return Ok(undefined);

  const objTarget = keysArgs[0];
  if (objTarget.getKind() !== SyntaxKind.Identifier) return Ok(undefined);

  if (mapArgs.length === 0) return Ok(undefined);

  const body = getArrowFunctionBody(mapArgs[0]);
  if (!body || body.getKind() !== SyntaxKind.ObjectLiteralExpression) return Ok(undefined);

  const bodyObj = body.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  const defProp = getPropertyAssignment(bodyObj, DEFAULT_PROPERTY);
  if (!defProp) return Ok(undefined);

  const defInit = defProp.getInitializer();
  const hasDefaultTrue =
    defInit?.getKind() === SyntaxKind.TrueKeyword ||
    (defInit?.getKind() === SyntaxKind.BinaryExpression &&
      defInit.asKindOrThrow(SyntaxKind.BinaryExpression).getOperatorToken().getKind() ===
        SyntaxKind.EqualsEqualsEqualsToken);

  if (!hasDefaultTrue) return Ok(undefined);

  const name = resolveFirstPropertyName(objTarget, checker);
  return name !== undefined ? Ok(name) : Ok(undefined);
};

const extractDefaultFromCallExpression = (
  call: Node,
  checker: TypeChecker
): SelectDefaultResult => {
  if (call.getKind() !== SyntaxKind.CallExpression) return Ok(undefined);

  const callExpr = call.asKindOrThrow(SyntaxKind.CallExpression);
  const expr = callExpr.getExpression();

  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return Ok(undefined);

  const propExpr = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
  if (propExpr.getName() !== 'map') return Ok(undefined);

  const target = propExpr.getExpression();
  if (!target) return Ok(undefined);

  const arrayExpr = target.asKind(SyntaxKind.ArrayLiteralExpression);
  if (arrayExpr) {
    const result = extractDefaultFromArrowFunction(callExpr.getArguments(), arrayExpr, checker);
    if (result.ok && result.value !== undefined) return result;
  }

  const targetIdent = target.asKind(SyntaxKind.Identifier);
  if (targetIdent) {
    const result = extractDefaultFromArrowFunction(callExpr.getArguments(), targetIdent, checker);
    if (result.ok && result.value !== undefined) return result;
  }

  const keysResult = extractDefaultFromObjectKeysMap(target, callExpr.getArguments(), checker);
  if (keysResult.ok && keysResult.value !== undefined) return keysResult;

  return Ok(undefined);
};

export const extractSelectDefault = (
  node: ObjectLiteralExpression,
  checker: TypeChecker
): SelectDefaultResult => {
  const prop = getPropertyAssignment(node, 'options');
  if (!prop) return Ok(undefined);

  const initializer = prop.getInitializer();
  if (!initializer) return Ok(undefined);

  const initUnwrapped = getArrowFunctionBody(initializer) ?? unwrapNode(initializer);

  if (initUnwrapped.getKind() === SyntaxKind.CallExpression) {
    const result = extractDefaultFromCallExpression(initUnwrapped, checker);
    if (result.ok && result.value !== undefined) return result;
    return Ok(undefined);
  }

  const arrExpr = initUnwrapped.asKind(SyntaxKind.ArrayLiteralExpression);
  if (!arrExpr) return Ok(undefined);

  return findDefaultInArrayLiteral(arrExpr.getElements(), checker);
};
