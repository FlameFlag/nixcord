import type { TypeChecker, ObjectLiteralExpression, Node } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { Result, Maybe } from 'true-myth';
import { find } from 'remeda';
import {
  asKind,
  getPropertyAssignment,
  getPropertyInitializer,
} from '../../../utils/node-helpers.js';
import { getArrowFunctionBody, evaluate } from '../../../foundation.js';
import { resolveIdentifierInitializerNode } from '../../node-utils.js';
import type { SelectDefaultResult } from '../../types.js';
import { DEFAULT_PROPERTY, VALUE_PROPERTY } from '../../constants.js';
import { resolveEnumLikeValue } from '../../enum-resolver.js';

const extractDefaultFromArrowFunction = (
  args: Node[],
  obj: Node,
  checker: TypeChecker
): SelectDefaultResult => {
  if (args.length === 0) return Result.ok(undefined);

  const body = getArrowFunctionBody(args[0]);
  if (body.isNothing || body.value.getKind() !== SyntaxKind.ObjectLiteralExpression) {
    return Result.ok(undefined);
  }

  const bodyObj = body.value.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  const defProp = getPropertyAssignment(bodyObj, DEFAULT_PROPERTY);

  if (defProp.isJust && defProp.value.getInitializer()?.getKind() === SyntaxKind.TrueKeyword) {
    const valueInit = getPropertyInitializer(bodyObj, VALUE_PROPERTY).unwrapOr(undefined);
    if (valueInit) {
      const valueVal = resolveEnumLikeValue(valueInit, checker);
      if (valueVal.isOk) return Result.ok(valueVal.value);
    }
  }

  if (defProp.isJust && defProp.value.getInitializer()?.getKind() === SyntaxKind.BinaryExpression) {
    const bin = defProp.value.getInitializer()?.asKind(SyntaxKind.BinaryExpression);
    if (!bin) return Result.ok(undefined);

    const right = bin.getRight();
    const val = resolveEnumLikeValue(right, checker);
    if (val.isOk) return Result.ok(val.value);

    const valueInit = getPropertyInitializer(bodyObj, VALUE_PROPERTY).unwrapOr(undefined);
    if (!valueInit) return Result.ok(undefined);
    const valueVal = resolveEnumLikeValue(valueInit, checker);
    return valueVal.isOk ? Result.ok(valueVal.value) : Result.ok(undefined);
  }

  if (defProp.isJust && defProp.value.getInitializer()?.getKind() === SyntaxKind.CallExpression) {
    const arrayExpr = obj.asKind(SyntaxKind.ArrayLiteralExpression);
    if (arrayExpr && arrayExpr.getElements().length > 0) {
      const firstEl = arrayExpr.getElements()[0];
      if (firstEl.getKind() === SyntaxKind.StringLiteral) {
        return Result.ok(firstEl.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue());
      }
      const val = resolveEnumLikeValue(firstEl, checker);
      if (val.isOk) return Result.ok(val.value);
    }
  }

  return Result.ok(undefined);
};

const findDefaultInArrayLiteral = (
  elements: readonly Node[],
  checker: TypeChecker
): SelectDefaultResult => {
  const findDefaultInElement = (element: Node): SelectDefaultResult => {
    if (element.getKind() === SyntaxKind.ObjectLiteralExpression) {
      const obj = element.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
      const defaultProp = getPropertyAssignment(obj, DEFAULT_PROPERTY);

      if (
        defaultProp.isNothing ||
        defaultProp.value.getInitializer()?.getKind() !== SyntaxKind.TrueKeyword
      ) {
        return Result.ok(undefined);
      }

      const valueInit = getPropertyInitializer(obj, VALUE_PROPERTY).unwrapOr(undefined);
      if (!valueInit) return Result.ok(undefined);

      const val = evaluate(valueInit, checker);
      return val.isOk ? Result.ok(val.value) : Result.ok(undefined);
    }

    if (element.getKind() === SyntaxKind.SpreadElement) {
      const spread = element.asKindOrThrow(SyntaxKind.SpreadElement);
      const expr = spread.getExpression();

      if (expr.getKind() === SyntaxKind.Identifier) {
        const init = resolveIdentifierInitializerNode(expr, checker);
        if (init.isJust && init.value.getKind() === SyntaxKind.ArrayLiteralExpression) {
          return findDefaultInArrayLiteral(
            init.value.asKindOrThrow(SyntaxKind.ArrayLiteralExpression).getElements(),
            checker
          );
        }
      }
    }

    return Result.ok(undefined);
  };

  const firstDefault = find(elements, (el) => {
    const result = findDefaultInElement(el);
    return result.isOk && result.value !== undefined;
  });

  return firstDefault ? findDefaultInElement(firstDefault) : Result.ok(undefined);
};

const extractDefaultFromCallExpression = (
  call: Node,
  checker: TypeChecker
): SelectDefaultResult => {
  if (call.getKind() !== SyntaxKind.CallExpression) return Result.ok(undefined);

  const callExpr = call.asKindOrThrow(SyntaxKind.CallExpression);
  const expr = callExpr.getExpression();

  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return Result.ok(undefined);

  const propExpr = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
  if (propExpr.getName() !== 'map') return Result.ok(undefined);

  const target = propExpr.getExpression();
  if (!target) return Result.ok(undefined);

  const arrayExpr = target.asKind(SyntaxKind.ArrayLiteralExpression);
  if (arrayExpr) {
    const result = extractDefaultFromArrowFunction(callExpr.getArguments(), arrayExpr, checker);
    if (result.isOk && result.value !== undefined) return result;
  }

  const targetIdent = target.asKind(SyntaxKind.Identifier);
  if (targetIdent) {
    const result = extractDefaultFromArrowFunction(callExpr.getArguments(), targetIdent, checker);
    if (result.isOk && result.value !== undefined) return result;
  }

  const targetCall = target.asKind(SyntaxKind.CallExpression);
  if (targetCall) {
    const innerPropExpr = targetCall.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
    if (innerPropExpr?.getName() === 'keys') {
      const keysArgs = targetCall.getArguments();
      if (keysArgs.length === 0) return Result.ok(undefined);

      const objTarget = keysArgs[0];
      if (objTarget.getKind() !== SyntaxKind.Identifier) return Result.ok(undefined);

      const args = callExpr.getArguments();
      if (args.length > 0) {
        const body = getArrowFunctionBody(args[0]);

        if (body.isJust && body.value.getKind() === SyntaxKind.ObjectLiteralExpression) {
          const bodyObj = body.value.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
          const defProp = getPropertyAssignment(bodyObj, DEFAULT_PROPERTY);

          if (defProp.isJust) {
            const defInit = defProp.value.getInitializer();
            const hasDefaultTrue =
              defInit?.getKind() === SyntaxKind.TrueKeyword ||
              (defInit?.getKind() === SyntaxKind.BinaryExpression &&
                defInit.asKindOrThrow(SyntaxKind.BinaryExpression).getOperatorToken().getKind() ===
                  SyntaxKind.EqualsEqualsEqualsToken);

            if (hasDefaultTrue) {
              const init = resolveIdentifierInitializerNode(objTarget, checker);
              const resolvedObj =
                init.isJust && init.value.getKind() === SyntaxKind.ObjectLiteralExpression
                  ? init.value.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
                  : objTarget
                      .getSourceFile()
                      .getVariableDeclaration(objTarget.getText())
                      ?.getInitializer()
                      ?.asKind(SyntaxKind.ObjectLiteralExpression);

              if (resolvedObj) {
                const firstProp = find(
                  resolvedObj.getProperties(),
                  (p) => p.getKind() === SyntaxKind.PropertyAssignment
                );
                if (firstProp)
                  return Result.ok(
                    firstProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getName()
                  );
              }
            }
          }
        }
      }
    }
  }

  return Result.ok(undefined);
};

export const extractSelectDefault = (
  node: ObjectLiteralExpression,
  checker: TypeChecker
): SelectDefaultResult => {
  const prop = getPropertyAssignment(node, 'options');
  if (prop.isNothing) return Result.ok(undefined);

  const initializer = prop.value.getInitializer();
  if (!initializer) return Result.ok(undefined);

  const initUnwrapped = getArrowFunctionBody(initializer).unwrapOr(initializer);

  if (initUnwrapped.getKind() === SyntaxKind.CallExpression) {
    const result = extractDefaultFromCallExpression(initUnwrapped, checker);
    if (result.isOk && result.value !== undefined) return result;
    return Result.ok(undefined);
  }

  const arrExpr = initUnwrapped.asKind(SyntaxKind.ArrayLiteralExpression);
  if (!arrExpr) return Result.ok(undefined);

  return findDefaultInArrayLiteral(arrExpr.getElements(), checker);
};
