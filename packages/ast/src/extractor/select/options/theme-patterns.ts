import type {
  TypeChecker,
  Node,
  ObjectLiteralExpression,
  CallExpression,
  AsExpression,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { Err } from '@nixcord/shared';

import type { SelectOptionsResult } from '../../types.js';
import { createSelectOptionsResult, createExtractionError, ExtractionErrorKind } from '../../types.js';
import { resolveIdentifierInitializerNode, evaluateThemesValues } from '../../node-utils.js';
import { getPropertyName, isMethodCall, iteratePropertyAssignments } from '../../../utils/node-helpers.js';
import { unwrapNode } from '../../../foundation.js';
import { METHOD_NAME_KEYS, VALUE_PROPERTY } from '../../constants.js';

const themePatternError = (node: Node): SelectOptionsResult =>
  Err(
    createExtractionError(
      ExtractionErrorKind.UnsupportedPattern,
      'Theme pattern not recognized',
      node
    )
  );

const extractThemeKeys = (arg0: Node, checker: TypeChecker): SelectOptionsResult => {
  const evaluated = evaluateThemesValues(arg0, checker);
  if (evaluated.length > 0) {
    return createSelectOptionsResult(evaluated);
  }

  const objNode = resolveIdentifierInitializerNode(arg0, checker);
  const obj = objNode?.asKind(SyntaxKind.ObjectLiteralExpression);

  if (!obj) {
    return Err(
      createExtractionError(
        ExtractionErrorKind.UnresolvableSymbol,
        'Cannot resolve object literal',
        arg0
      )
    );
  }

  const keys = Array.from(iteratePropertyAssignments(obj))
    .map((p) => getPropertyName(p) ?? '')
    .filter((k) => k !== '');

  return keys.length > 0
    ? createSelectOptionsResult(keys)
    : Err(createExtractionError(ExtractionErrorKind.CannotEvaluate, 'No theme keys found', arg0));
};

const extractFromArrowFunctionBody = (args: Node[], checker: TypeChecker): SelectOptionsResult => {
  if (args.length === 0) {
    return Err(
      createExtractionError(
        ExtractionErrorKind.MissingProperty,
        'Arrow function has no arguments',
        args[0]
      )
    );
  }

  const firstArg = args[0];
  const arrowFunc = firstArg.asKind(SyntaxKind.ArrowFunction);
  if (!arrowFunc) {
    return Err(
      createExtractionError(ExtractionErrorKind.InvalidNodeType, 'Expected ArrowFunction', firstArg)
    );
  }

  let body = arrowFunc.getBody();
  if (body) body = unwrapNode(body);

  const obj = body.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!obj) return themePatternError(body);

  const valuePropRaw = obj.getProperty(VALUE_PROPERTY);
  const valueProp = valuePropRaw?.asKind(SyntaxKind.PropertyAssignment);
  if (!valueProp) return themePatternError(obj);

  const vinit = valueProp.getInitializer();
  if (!vinit || vinit.getKind() !== SyntaxKind.ElementAccessExpression)
    return themePatternError(obj);

  const ea = vinit.asKindOrThrow(SyntaxKind.ElementAccessExpression);
  const themesIdent = ea.getExpression().asKind(SyntaxKind.Identifier);
  if (!themesIdent) return themePatternError(obj);

  const values = evaluateThemesValues(themesIdent, checker);
  return values.length > 0
    ? createSelectOptionsResult(values)
    : themePatternError(obj);
};

const extractFromObjectKeysCall = (
  ic: CallExpression,
  checker: TypeChecker
): SelectOptionsResult => {
  if (!isMethodCall(ic, METHOD_NAME_KEYS)) {
    return Err(
      createExtractionError(
        ExtractionErrorKind.UnsupportedPattern,
        'Expected Object.keys() pattern',
        ic
      )
    );
  }

  const arg0 = ic.getArguments()[0];
  if (!arg0 || arg0.getKind() !== SyntaxKind.Identifier) {
    return Err(
      createExtractionError(ExtractionErrorKind.UnsupportedPattern, 'Expected Identifier argument', ic)
    );
  }

  return extractThemeKeys(arg0, checker);
};

export function extractOptionsFromThemePattern(
  target: Node,
  call: Node,
  checker: TypeChecker
): SelectOptionsResult {
  const ident = target.asKind(SyntaxKind.Identifier);
  if (!ident) {
    return Err(
      createExtractionError(
        ExtractionErrorKind.InvalidNodeType,
        'Expected Identifier for theme pattern',
        target
      )
    );
  }

  const callExpr = call.asKind(SyntaxKind.CallExpression);
  if (!callExpr) {
    return Err(
      createExtractionError(ExtractionErrorKind.InvalidNodeType, 'Expected CallExpression', call)
    );
  }

  const args = callExpr.getArguments();
  if (args.length > 0) {
    const result = extractFromArrowFunctionBody(args, checker);
    if (result.ok) return result;
  }

  const initNode = resolveIdentifierInitializerNode(ident, checker);
  if (initNode === undefined) return themePatternError(target);

  const ic = initNode.asKind(SyntaxKind.CallExpression);
  if (ic) {
    const result = extractFromObjectKeysCall(ic, checker);
    if (result.ok) return result;
  }

  const asExpr = initNode.asKind(SyntaxKind.AsExpression);
  if (asExpr) {
    const expr = unwrapNode(asExpr.getExpression());
    const innerCall = expr.asKind(SyntaxKind.CallExpression);
    if (innerCall) {
      const result = extractFromObjectKeysCall(innerCall, checker);
      if (result.ok) return result;
    }
    return themePatternError(asExpr);
  }

  return themePatternError(target);
}
