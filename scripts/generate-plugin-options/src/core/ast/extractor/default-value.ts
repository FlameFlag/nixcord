import type {
  TypeChecker,
  ObjectLiteralExpression,
  BigIntLiteral,
  CallExpression,
  Node,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { Result } from 'true-myth';
import { pipe, reduce } from 'remeda';
import { iteratePropertyAssignments } from '../utils/node-helpers.js';
import { resolveIdentifierInitializerNode, resolveCallExpressionReturn } from './node-utils.js';
import { unwrapNode, tryEvaluate, isCollectionKind } from '../foundation.js';
import { getPropertyInitializer } from '../utils/node-helpers.js';
import { DEFAULT_PROPERTY, GET_FUNCTION_NAME } from './constants.js';
import type { DefaultValueResult } from './types.js';
import { createExtractionError, ExtractionErrorKind } from './types.js';

const handleEmpty = (kind: SyntaxKind): DefaultValueResult => {
  if (kind === SyntaxKind.ArrayLiteralExpression) return Result.ok([]);
  if (kind === SyntaxKind.ObjectLiteralExpression) return Result.ok({});
  return Result.ok(undefined);
};

const handleIdentifier = (
  unwrappedInitializer: Node,
  checker: TypeChecker,
  identText: string
): DefaultValueResult => {
  if (identText === 'undefined') return Result.ok(null);

  try {
    const init = resolveIdentifierInitializerNode(unwrappedInitializer, checker);
    if (init.isNothing) return Result.ok(undefined);

    const unwrappedNode = unwrapNode(init.value);
    if (unwrappedNode.getText() === 'undefined' || unwrappedNode.getKind() === 131)
      return Result.ok(null);
    if (isCollectionKind(unwrappedNode.getKind())) return handleEmpty(unwrappedNode.getKind());

    return Result.ok(tryEvaluate(init.value, checker));
  } catch (error) {
    return Result.err(
      createExtractionError(
        ExtractionErrorKind.CannotEvaluate,
        `Error resolving identifier ${identText}: ${error instanceof Error ? error.message : String(error)}`,
        unwrappedInitializer
      )
    );
  }
};

const handleCallExpression = (
  callExpr: CallExpression,
  checker: TypeChecker
): DefaultValueResult => {
  const args = callExpr.getArguments();
  const objLiteral = args[0]?.asKind(SyntaxKind.ObjectLiteralExpression);

  if (!objLiteral) {
    // Try to resolve the call return type, but fall back to conservative defaults
    const resolved = resolveCallExpressionReturn(callExpr, checker);
    if (resolved.isJust) {
      return handleEmpty(resolved.value.getKind());
    }

    // For unresolvable calls like Object.fromEntries, Object.assign, etc.,
    // return a conservative empty object
    const expr = callExpr.getExpression();
    const exprText = expr.getText();
    if (exprText.startsWith('Object.') || exprText.startsWith('Array.')) {
      // Object.fromEntries, Object.assign, etc. return objects
      if (
        exprText.includes('fromEntries') ||
        exprText.includes('assign') ||
        exprText.includes('create')
      ) {
        return Result.ok({});
      }
      // Object.keys, Object.values, Object.entries return arrays
      if (
        exprText.includes('keys') ||
        exprText.includes('values') ||
        exprText.includes('entries')
      ) {
        return Result.ok([]);
      }
    }
    return Result.ok(undefined);
  }

  const result = pipe(
    Array.from(iteratePropertyAssignments(objLiteral)),
    reduce((acc: Record<string, unknown>, propAssign) => {
      const propName = propAssign.getNameNode();
      const key =
        propName.getKind() === SyntaxKind.Identifier ||
        propName.getKind() === SyntaxKind.StringLiteral
          ? propName.getText().replace(/['"]/g, '')
          : undefined;

      const propInitializer = propAssign.getInitializer();
      if (!key || !propInitializer) return acc;

      const value = tryEvaluate(propInitializer, checker);
      return value !== undefined
        ? { ...acc, [key]: value }
        : isCollectionKind(propInitializer.getKind())
          ? {
              ...acc,
              [key]: propInitializer.getKind() === SyntaxKind.ArrayLiteralExpression ? [] : {},
            }
          : acc;
    }, {})
  );
  return Result.ok(result);
};

export function extractDefaultValue(
  node: ObjectLiteralExpression,
  checker: TypeChecker
): DefaultValueResult {
  const initializer = getPropertyInitializer(node, DEFAULT_PROPERTY).unwrapOr(undefined);
  if (!initializer) return Result.ok(undefined);

  const unwrappedInitializer = unwrapNode(initializer);
  const kind = unwrappedInitializer.getKind();

  if (kind === SyntaxKind.TemplateExpression) return Result.ok(undefined);

  if (kind === SyntaxKind.BigIntLiteral) {
    const raw = (unwrappedInitializer as BigIntLiteral).getText();
    return Result.ok(raw.toLowerCase().endsWith('n') ? raw.slice(0, -1) : raw);
  }

  if (kind === SyntaxKind.NullKeyword || kind === SyntaxKind.UndefinedKeyword) {
    return Result.ok(null);
  }

  if (isCollectionKind(kind)) return handleEmpty(kind);

  if (kind === SyntaxKind.PropertyAccessExpression) {
    const expr = unwrappedInitializer.asKind(SyntaxKind.PropertyAccessExpression);
    const ident = expr?.getExpression().asKind(SyntaxKind.Identifier);
    return ident?.getText() === GET_FUNCTION_NAME
      ? Result.ok(undefined)
      : Result.ok(tryEvaluate(unwrappedInitializer, checker));
  }

  if (kind === SyntaxKind.Identifier) {
    return handleIdentifier(unwrappedInitializer, checker, unwrappedInitializer.getText());
  }

  if (kind === SyntaxKind.CallExpression) {
    const callExpr = unwrappedInitializer.asKind(SyntaxKind.CallExpression);
    return callExpr ? handleCallExpression(callExpr, checker) : Result.ok(undefined);
  }

  const evaluated = tryEvaluate(unwrappedInitializer, checker);
  return evaluated !== undefined
    ? Result.ok(evaluated)
    : Result.err(
        createExtractionError(
          ExtractionErrorKind.CannotEvaluate,
          `Cannot evaluate default value from node kind: ${unwrappedInitializer.getKindName()}`,
          unwrappedInitializer
        )
      );
}
