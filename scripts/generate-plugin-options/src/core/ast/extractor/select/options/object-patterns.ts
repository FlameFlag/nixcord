import type {
  TypeChecker,
  Node,
  PropertyAssignment,
  ObjectLiteralExpression,
  CallExpression,
  AsExpression,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { Result, Maybe } from 'true-myth';
import { pipe, filter, map } from 'remeda';
import { evaluate, unwrapNode } from '../../../foundation.js';
import type { SelectOptionsResult } from '../../types.js';
import { createExtractionError, ExtractionErrorKind } from '../../types.js';
import { resolveIdentifierInitializerNode } from '../../node-utils.js';
import { isMethodCall, iteratePropertyAssignments } from '../../../utils/node-helpers.js';

const METHOD_NAME_KEYS = 'keys';
const METHOD_NAME_VALUES = 'values';

export function extractOptionsFromObjectKeys(
  call: Node,
  checker: TypeChecker
): SelectOptionsResult {
  const innerCall = call.asKind(SyntaxKind.CallExpression);
  if (!innerCall) {
    return Result.err(
      createExtractionError(
        ExtractionErrorKind.InvalidNodeType,
        'Expected CallExpression for Object.keys()',
        call
      )
    );
  }

  const keysMethod = isMethodCall(innerCall, METHOD_NAME_KEYS).unwrapOr(undefined);
  if (!keysMethod) {
    return Result.err(
      createExtractionError(
        ExtractionErrorKind.UnsupportedPattern,
        'Expected Object.keys() pattern',
        call
      )
    );
  }

  const firstArg = innerCall.getArguments()[0];
  if (!firstArg || firstArg.getKind() !== SyntaxKind.Identifier) {
    return Result.err(
      createExtractionError(
        ExtractionErrorKind.UnresolvableSymbol,
        'Object.keys() argument must be an identifier',
        call
      )
    );
  }

  const init = resolveIdentifierInitializerNode(
    firstArg.asKindOrThrow(SyntaxKind.Identifier),
    checker
  );

  const objLiteral = init.andThen((node) => {
    const asExpr = node.asKind(SyntaxKind.AsExpression);
    return Maybe.just(asExpr ? unwrapNode(asExpr.getExpression()) : node);
  });

  if (objLiteral.isNothing || objLiteral.value.getKind() !== SyntaxKind.ObjectLiteralExpression) {
    return Result.err(
      createExtractionError(
        ExtractionErrorKind.UnresolvableSymbol,
        `Cannot resolve identifier ${firstArg.asKindOrThrow(SyntaxKind.Identifier).getText()} to object literal`,
        firstArg
      )
    );
  }

  const obj = objLiteral.value.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  const keys = pipe(
    Array.from(iteratePropertyAssignments(obj)),
    map((p) => {
      const nameNode = p.getNameNode();
      return nameNode.getKind() === SyntaxKind.Identifier
        ? nameNode.asKindOrThrow(SyntaxKind.Identifier).getText()
        : nameNode.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();
    })
  );

  return Result.ok({ values: Object.freeze(keys), labels: Object.freeze({}) });
}

export function extractOptionsFromObjectValues(
  call: Node,
  checker: TypeChecker
): SelectOptionsResult {
  const innerCall = call.asKind(SyntaxKind.CallExpression);
  if (!innerCall) {
    return Result.err(
      createExtractionError(
        ExtractionErrorKind.InvalidNodeType,
        'Expected CallExpression for Object.values()',
        call
      )
    );
  }

  const valuesMethod = isMethodCall(innerCall, METHOD_NAME_VALUES).unwrapOr(undefined);
  if (!valuesMethod) {
    return Result.err(
      createExtractionError(
        ExtractionErrorKind.UnsupportedPattern,
        'Expected Object.values() pattern',
        call
      )
    );
  }

  const firstArg = innerCall.getArguments()[0];
  if (!firstArg || firstArg.getKind() !== SyntaxKind.Identifier) {
    return Result.err(
      createExtractionError(
        ExtractionErrorKind.UnresolvableSymbol,
        'Object.values() argument must be an identifier',
        call
      )
    );
  }

  const init = resolveIdentifierInitializerNode(
    firstArg.asKindOrThrow(SyntaxKind.Identifier),
    checker
  );

  const objLiteral = init.andThen((node) => {
    const asExpr = node.asKind(SyntaxKind.AsExpression);
    return Maybe.just(asExpr ? unwrapNode(asExpr.getExpression()) : node);
  });

  if (objLiteral.isNothing || objLiteral.value.getKind() !== SyntaxKind.ObjectLiteralExpression) {
    return Result.err(
      createExtractionError(
        ExtractionErrorKind.UnresolvableSymbol,
        `Cannot resolve identifier ${firstArg.asKindOrThrow(SyntaxKind.Identifier).getText()} to object literal`,
        firstArg
      )
    );
  }

  const obj = objLiteral.value.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  const values = pipe(
    obj.getProperties(),
    filter((p): p is PropertyAssignment => p.getKind() === SyntaxKind.PropertyAssignment),
    map((p) => {
      const propAssign = p.asKindOrThrow(SyntaxKind.PropertyAssignment);
      const init = propAssign.getInitializer();
      if (!init) return null;
      const resolved = evaluate(init, checker);
      return resolved.isOk ? resolved.value : null;
    }),
    filter((val): val is string | number | boolean => val !== null)
  );

  return Result.ok({ values: Object.freeze(values), labels: Object.freeze({}) });
}
