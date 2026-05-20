import { Err, fromNullable, Ok, type Result } from '@nixcord/shared';
import type {
  ArrayLiteralExpression,
  Identifier,
  Node,
  ObjectLiteralExpression,
  SpreadElement,
  TypeChecker,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import type { EvaluationError } from '../../../foundation/index.js';
import {
  asKind,
  createEvaluationError,
  evaluate,
  getPropertyAssignment,
  resolveCallExpressionReturn,
  resolveIdentifierInitializerNode,
  resolveSymbolInit,
  tryEvaluate,
} from '../../../foundation/index.js';
import { LABEL_PROPERTY, VALUE_PROPERTY } from '../../constants.js';
import type { SelectOptionsResult } from '../../types.js';
import {
  createExtractionError,
  createSelectOptionsResult,
  ExtractionErrorKind,
  extractionErrors,
} from '../../types.js';
import { isArrayFromCall } from '../patterns/index.js';

const addValueAndLabel = (
  values: (string | number | boolean)[],
  labels: Record<string, string>,
  valueResult: Result<{ value: string | number | boolean; label?: string }, EvaluationError>
): void => {
  if (valueResult.ok) {
    values.push(valueResult.value.value);
    if (valueResult.value.label !== undefined) {
      labels[String(valueResult.value.value)] = valueResult.value.label;
    }
  }
};

const extractValueAndLabel = (
  obj: ObjectLiteralExpression,
  checker: TypeChecker
): Result<{ value: string | number | boolean; label?: string }, EvaluationError> => {
  const valueProp = fromNullable(getPropertyAssignment(obj, VALUE_PROPERTY), () =>
    createEvaluationError(`Missing '${VALUE_PROPERTY}' property in option object`, obj)
  );
  if (!valueProp.ok) return valueProp;

  const valueInit = fromNullable(valueProp.value.getInitializer(), () =>
    createEvaluationError(`'${VALUE_PROPERTY}' property has no initializer`, valueProp.value)
  );
  if (!valueInit.ok) return valueInit;

  const valueResult = evaluate(valueInit.value, checker);
  if (!valueResult.ok) return valueResult;

  const labelProp = getPropertyAssignment(obj, LABEL_PROPERTY);
  const label = labelProp
    ? labelProp.getInitializer()?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue()
    : undefined;

  return Ok(label ? { value: valueResult.value, label } : { value: valueResult.value });
};

const extractValuesFromArrayLiteral = (
  spreadArray: ArrayLiteralExpression,
  checker: TypeChecker
): { values: readonly (string | number | boolean)[]; labels: Record<string, string> } => {
  const values: (string | number | boolean)[] = [];
  const labels: Record<string, string> = {};

  for (const elem of spreadArray.getElements()) {
    if (elem.getKind() === SyntaxKind.ObjectLiteralExpression) {
      addValueAndLabel(
        values,
        labels,
        extractValueAndLabel(elem.asKindOrThrow(SyntaxKind.ObjectLiteralExpression), checker)
      );
    }
  }

  return { values: Object.freeze(values), labels };
};

const extractFromSpreadElement = (
  spread: SpreadElement,
  checker: TypeChecker
): Result<
  { values: readonly (string | number | boolean)[]; labels: Record<string, string> },
  EvaluationError
> => {
  const expr = spread.getExpression();

  if (expr.getKind() === SyntaxKind.Identifier) {
    const identifier = expr.asKindOrThrow(SyntaxKind.Identifier);
    const init = fromNullable(resolveSymbolInit(identifier, checker), () =>
      createEvaluationError(`Cannot resolve spread element: ${identifier.getText()}`, spread)
    );
    if (!init.ok) return init;

    const spreadArray = fromNullable(init.value.asKind(SyntaxKind.ArrayLiteralExpression), () =>
      createEvaluationError('Spread element does not resolve to an array literal', spread)
    );
    if (!spreadArray.ok) return spreadArray;

    return Ok(extractValuesFromArrayLiteral(spreadArray.value, checker));
  }

  if (expr.getKind() === SyntaxKind.CallExpression) {
    const resolved = resolveCallExpressionReturn(expr, checker);
    if (resolved) {
      const resolvedArray = resolved.asKind(SyntaxKind.ArrayLiteralExpression);
      if (resolvedArray) {
        return Ok(extractValuesFromArrayLiteral(resolvedArray, checker));
      }
    }
    return Err(
      createEvaluationError('Spread call expression does not resolve to an array literal', spread)
    );
  }

  if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
    const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    const init = resolveSymbolInit(propAccess, checker);

    if (init) {
      const spreadArray = init.asKind(SyntaxKind.ArrayLiteralExpression);
      if (spreadArray) {
        return Ok(extractValuesFromArrayLiteral(spreadArray, checker));
      }
    }

    return Err(
      createEvaluationError('Spread property access does not resolve to an array literal', spread)
    );
  }

  return Err(createEvaluationError('Unsupported spread element expression kind', spread));
};

export function extractOptionsFromArrayMap(arr: Node, checker: TypeChecker): SelectOptionsResult {
  const arrayExpr = arr.asKind(SyntaxKind.ArrayLiteralExpression);
  if (!arrayExpr) {
    return extractionErrors.invalidNodeType('ArrayLiteralExpression', arr);
  }

  const results = arrayExpr
    .asKindOrThrow(SyntaxKind.ArrayLiteralExpression)
    .getElements()
    .map((el) => evaluate(el, checker));

  const okResults = results.filter(
    (result): result is Extract<typeof result, { ok: true }> => result.ok
  );
  const errResults = results.filter((r) => !r.ok);

  const values = okResults.map((result) => result.value);
  const errors = errResults.map(
    (result) => (result as Extract<typeof result, { ok: false }>).error.message
  );

  if (errors.length > 0 && values.length === 0) {
    return extractionErrors.cannotEvaluate(`Failed to extract options: ${errors.join('; ')}`, arr);
  }

  return createSelectOptionsResult(values);
}

export function extractOptionsFromArrayFrom(call: Node, checker: TypeChecker): SelectOptionsResult {
  if (!isArrayFromCall(call)) {
    return extractionErrors.unsupportedPattern('Expected Array.from() pattern', call);
  }

  const callExpr = call.asKindOrThrow(SyntaxKind.CallExpression);
  const firstArg = callExpr.getArguments()[0];
  if (!firstArg) {
    return Err(
      createExtractionError(
        ExtractionErrorKind.MissingProperty,
        'Array.from() requires at least one argument',
        call
      )
    );
  }

  const arr = firstArg.asKind(SyntaxKind.ArrayLiteralExpression);
  if (arr) return extractOptionsFromArrayMap(arr, checker);

  const ident = firstArg.asKind(SyntaxKind.Identifier);
  if (!ident) {
    return extractionErrors.unsupportedPattern(
      'Array.from() pattern not supported for this argument type',
      call
    );
  }

  const resolvedNode = resolveIdentifierInitializerNode(ident, checker);
  const resolvedArr = resolvedNode?.asKind(SyntaxKind.ArrayLiteralExpression);

  if (resolvedArr) return extractOptionsFromArrayMap(resolvedArr, checker);

  return extractionErrors.unsupportedPattern(
    'Array.from() pattern not supported for this argument type',
    call
  );
}

export function extractOptionsFromObjectArray(
  arr: ArrayLiteralExpression,
  checker: TypeChecker
): SelectOptionsResult {
  const values: (string | number | boolean)[] = [];
  const labels: Record<string, string> = {};
  const hasElements = arr.getElements().length > 0;

  const hasMissingValueProp = arr.getElements().some((element) => {
    if (element.getKind() === SyntaxKind.ObjectLiteralExpression) {
      const obj = element.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
      return getPropertyAssignment(obj, VALUE_PROPERTY) === undefined;
    }
    return false;
  });

  for (const element of arr.getElements()) {
    if (element.getKind() === SyntaxKind.ObjectLiteralExpression) {
      addValueAndLabel(
        values,
        labels,
        extractValueAndLabel(element.asKindOrThrow(SyntaxKind.ObjectLiteralExpression), checker)
      );
    } else if (element.getKind() === SyntaxKind.SpreadElement) {
      const spreadResult = extractFromSpreadElement(
        element.asKindOrThrow(SyntaxKind.SpreadElement),
        checker
      );
      if (spreadResult.ok) {
        values.push(...spreadResult.value.values);
        Object.assign(labels, spreadResult.value.labels);
      }
    }
  }

  if (values.length === 0 && hasElements) {
    return extractionErrors.cannotEvaluate(
      hasMissingValueProp ? "Missing 'value' property" : 'No evaluable elements in array',
      arr
    );
  }

  return createSelectOptionsResult(values, labels);
}
