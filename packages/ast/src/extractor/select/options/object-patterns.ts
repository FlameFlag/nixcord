import type {
  TypeChecker,
  Node,
  ObjectLiteralExpression,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { Err } from '@nixcord/shared';

import { evaluate, unwrapNode } from '../../../foundation.js';
import type { SelectOptionsResult } from '../../types.js';
import { createSelectOptionsResult, createExtractionError, ExtractionErrorKind } from '../../types.js';
import { resolveIdentifierInitializerNode } from '../../node-utils.js';
import { isMethodCall, iteratePropertyAssignments } from '../../../utils/node-helpers.js';
import { METHOD_NAME_KEYS, METHOD_NAME_VALUES } from '../../constants.js';

function extractFromObjectMethod(
  call: Node,
  methodName: string,
  checker: TypeChecker,
  extractor: (obj: ObjectLiteralExpression, checker: TypeChecker) => (string | number | boolean)[]
): SelectOptionsResult {
  const innerCall = call.asKind(SyntaxKind.CallExpression);
  if (!innerCall) {
    return Err(
      createExtractionError(
        ExtractionErrorKind.InvalidNodeType,
        `Expected CallExpression for Object.${methodName}()`,
        call
      )
    );
  }

  if (!isMethodCall(innerCall, methodName)) {
    return Err(
      createExtractionError(
        ExtractionErrorKind.UnsupportedPattern,
        `Expected Object.${methodName}() pattern`,
        call
      )
    );
  }

  const firstArg = innerCall.getArguments()[0];
  if (!firstArg || firstArg.getKind() !== SyntaxKind.Identifier) {
    return Err(
      createExtractionError(
        ExtractionErrorKind.UnresolvableSymbol,
        `Object.${methodName}() argument must be an identifier`,
        call
      )
    );
  }

  const init = resolveIdentifierInitializerNode(
    firstArg.asKindOrThrow(SyntaxKind.Identifier),
    checker
  );

  const objLiteral =
    init !== undefined
      ? (() => {
          const asExpr = init.asKind(SyntaxKind.AsExpression);
          return asExpr ? unwrapNode(asExpr.getExpression()) : init;
        })()
      : undefined;

  if (!objLiteral || objLiteral.getKind() !== SyntaxKind.ObjectLiteralExpression) {
    return Err(
      createExtractionError(
        ExtractionErrorKind.UnresolvableSymbol,
        `Cannot resolve identifier ${firstArg.asKindOrThrow(SyntaxKind.Identifier).getText()} to object literal`,
        firstArg
      )
    );
  }

  const obj = objLiteral.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  const values = extractor(obj, checker);
  return createSelectOptionsResult(values);
}

const extractKeys = (obj: ObjectLiteralExpression): (string | number | boolean)[] =>
  Array.from(iteratePropertyAssignments(obj)).map((p) => {
    const nameNode = p.getNameNode();
    return nameNode.getKind() === SyntaxKind.Identifier
      ? nameNode.asKindOrThrow(SyntaxKind.Identifier).getText()
      : nameNode.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();
  });

const extractValues = (obj: ObjectLiteralExpression, checker: TypeChecker): (string | number | boolean)[] =>
  Array.from(iteratePropertyAssignments(obj))
    .map((p) => {
      const init = p.getInitializer();
      if (!init) return null;
      const resolved = evaluate(init, checker);
      return resolved.ok ? resolved.value : null;
    })
    .filter((val): val is string | number | boolean => val !== null);

export function extractOptionsFromObjectKeys(
  call: Node,
  checker: TypeChecker
): SelectOptionsResult {
  return extractFromObjectMethod(call, METHOD_NAME_KEYS, checker, extractKeys);
}

export function extractOptionsFromObjectValues(
  call: Node,
  checker: TypeChecker
): SelectOptionsResult {
  return extractFromObjectMethod(call, METHOD_NAME_VALUES, checker, extractValues);
}
