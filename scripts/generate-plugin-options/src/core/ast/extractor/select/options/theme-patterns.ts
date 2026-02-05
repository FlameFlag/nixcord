import type {
  TypeChecker,
  Node,
  PropertyAssignment,
  ObjectLiteralExpression,
  CallExpression,
  Identifier,
  AsExpression,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { Result, Maybe } from 'true-myth';
import { pipe, filter, map } from 'remeda';
import type { SelectOptionsResult } from '../../types.js';
import { createExtractionError, ExtractionErrorKind } from '../../types.js';
import { resolveIdentifierInitializerNode, evaluateThemesValues } from '../../node-utils.js';
import { getPropertyName } from '../../../utils/node-helpers.js';
import { isMethodCall } from '../../../utils/node-helpers.js';
import { unwrapNode } from '../../../foundation.js';
import { iteratePropertyAssignments } from '../../../utils/node-helpers.js';

const METHOD_NAME_KEYS = 'keys';
const VALUE_PROPERTY = 'value';

const extractThemeKeys = (arg0: Node, checker: TypeChecker): SelectOptionsResult => {
  const evaluated = evaluateThemesValues(arg0, checker);
  if (evaluated.length > 0) {
    return Result.ok({ values: Object.freeze(evaluated), labels: Object.freeze({}) });
  }

  const objInit = resolveIdentifierInitializerNode(arg0, checker);
  const objNode = objInit.unwrapOr(undefined);
  const obj = objNode?.asKind(SyntaxKind.ObjectLiteralExpression);

  if (!obj) {
    return Result.err(
      createExtractionError(
        ExtractionErrorKind.UnresolvableSymbol,
        'Cannot resolve object literal',
        arg0
      )
    );
  }

  const keys = pipe(
    Array.from(iteratePropertyAssignments(obj)),
    map((p) => getPropertyName(p).unwrapOr('')),
    filter((k) => k !== '')
  );

  return keys.length > 0
    ? Result.ok({ values: Object.freeze(keys), labels: Object.freeze({}) })
    : Result.err(
        createExtractionError(ExtractionErrorKind.CannotEvaluate, 'No theme keys found', arg0)
      );
};

const extractFromArrowFunctionBody = (args: Node[], checker: TypeChecker): SelectOptionsResult => {
  if (args.length === 0) {
    return Result.err(
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
    return Result.err(
      createExtractionError(ExtractionErrorKind.InvalidNodeType, 'Expected ArrowFunction', firstArg)
    );
  }

  let body = arrowFunc.getBody();
  if (body) body = unwrapNode(body);

  const obj = body.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!obj) {
    return Result.err(
      createExtractionError(
        ExtractionErrorKind.UnsupportedPattern,
        'Theme pattern not recognized',
        body
      )
    );
  }

  const valuePropRaw = obj.getProperty(VALUE_PROPERTY);
  const valueProp = valuePropRaw?.asKind(SyntaxKind.PropertyAssignment);
  if (!valueProp) {
    return Result.err(
      createExtractionError(
        ExtractionErrorKind.UnsupportedPattern,
        'Theme pattern not recognized',
        obj
      )
    );
  }

  const vinit = valueProp.getInitializer();
  if (!vinit || vinit.getKind() !== SyntaxKind.ElementAccessExpression) {
    return Result.err(
      createExtractionError(
        ExtractionErrorKind.UnsupportedPattern,
        'Theme pattern not recognized',
        obj
      )
    );
  }

  const ea = vinit.asKindOrThrow(SyntaxKind.ElementAccessExpression);
  const themesExpr = ea.getExpression();
  const themesIdent = themesExpr.asKind(SyntaxKind.Identifier);

  if (!themesIdent) {
    return Result.err(
      createExtractionError(
        ExtractionErrorKind.UnsupportedPattern,
        'Theme pattern not recognized',
        obj
      )
    );
  }

  const values = evaluateThemesValues(themesIdent, checker);
  return values.length > 0
    ? Result.ok({ values: Object.freeze(values), labels: Object.freeze({}) })
    : Result.err(
        createExtractionError(
          ExtractionErrorKind.UnsupportedPattern,
          'Theme pattern not recognized',
          obj
        )
      );
};

const extractFromObjectKeysCall = (
  ic: CallExpression,
  checker: TypeChecker
): SelectOptionsResult => {
  const keysMethod = isMethodCall(ic, METHOD_NAME_KEYS).unwrapOr(undefined);
  if (!keysMethod) {
    return Result.err(
      createExtractionError(
        ExtractionErrorKind.UnsupportedPattern,
        'Expected Object.keys() pattern',
        ic
      )
    );
  }

  const args = ic.getArguments();
  if (args.length === 0) {
    return Result.err(
      createExtractionError(ExtractionErrorKind.UnsupportedPattern, 'Expected arguments', ic)
    );
  }

  const arg0 = ic.getArguments()[0];
  if (!arg0 || arg0.getKind() !== SyntaxKind.Identifier) {
    return Result.err(
      createExtractionError(
        ExtractionErrorKind.UnsupportedPattern,
        'Expected Identifier argument',
        ic
      )
    );
  }

  return extractThemeKeys(arg0, checker);
};

const extractFromObjectKeysCallAsExpression = (
  asExpr: AsExpression,
  checker: TypeChecker
): SelectOptionsResult => {
  const expr = unwrapNode(asExpr.getExpression());
  const ic = expr.asKind(SyntaxKind.CallExpression);
  if (!ic) {
    return Result.err(
      createExtractionError(
        ExtractionErrorKind.UnsupportedPattern,
        'Theme pattern not recognized',
        asExpr
      )
    );
  }

  const result = extractFromObjectKeysCall(ic, checker);
  if (result.isOk) return result;

  return Result.err(
    createExtractionError(
      ExtractionErrorKind.UnsupportedPattern,
      'Theme pattern not recognized',
      asExpr
    )
  );
};

export function extractOptionsFromThemePattern(
  target: Node,
  call: Node,
  checker: TypeChecker
): SelectOptionsResult {
  const ident = target.asKind(SyntaxKind.Identifier);
  if (!ident) {
    return Result.err(
      createExtractionError(
        ExtractionErrorKind.InvalidNodeType,
        'Expected Identifier for theme pattern',
        target
      )
    );
  }

  const callExpr = call.asKind(SyntaxKind.CallExpression);
  if (!callExpr) {
    return Result.err(
      createExtractionError(ExtractionErrorKind.InvalidNodeType, 'Expected CallExpression', call)
    );
  }

  const args = callExpr.getArguments();
  if (args.length > 0) {
    const result = extractFromArrowFunctionBody(args, checker);
    if (result.isOk) return result;
  }

  const identInit = resolveIdentifierInitializerNode(ident, checker);
  if (identInit.isNothing) {
    return Result.err(
      createExtractionError(
        ExtractionErrorKind.UnsupportedPattern,
        'Theme pattern not recognized',
        target
      )
    );
  }

  const initNode = identInit.value;
  const ic = initNode.asKind(SyntaxKind.CallExpression);
  if (ic) {
    const result = extractFromObjectKeysCall(ic, checker);
    if (result.isOk) return result;
  }

  const asExpr = initNode.asKind(SyntaxKind.AsExpression);
  if (asExpr) {
    return extractFromObjectKeysCallAsExpression(asExpr, checker);
  }

  return Result.err(
    createExtractionError(
      ExtractionErrorKind.UnsupportedPattern,
      'Theme pattern not recognized',
      target
    )
  );
}
