import type {
  TypeChecker,
  Node,
  SpreadElement,
  ObjectLiteralExpression,
  ArrayLiteralExpression,
  Identifier,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { type Result, Ok, Err } from '@nixcord/shared';

import { evaluate, tryEvaluate, createEvaluationError } from '../../../foundation.js';
import type { EvaluationError } from '../../../foundation.js';
import type { SelectOptionsResult } from '../../types.js';
import {
  extractionErrors,
  createSelectOptionsResult,
  createExtractionError,
  ExtractionErrorKind,
} from '../../types.js';
import { resolveIdentifierInitializerNode } from '../../node-utils.js';
import { isArrayFromCall } from '../patterns/index.js';
import { asKind, getPropertyAssignment } from '../../../utils/node-helpers.js';
import { VALUE_PROPERTY, LABEL_PROPERTY } from '../../constants.js';

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
  const valueProp = getPropertyAssignment(obj, VALUE_PROPERTY);

  if (!valueProp) {
    return Err(createEvaluationError(`Missing '${VALUE_PROPERTY}' property in option object`, obj));
  }

  const valueInit = valueProp.getInitializer();
  if (!valueInit) {
    return Err(createEvaluationError(`'${VALUE_PROPERTY}' property has no initializer`, valueProp));
  }

  const valueResult = evaluate(valueInit, checker);
  if (!valueResult.ok) return Err(valueResult.error);

  const labelProp = getPropertyAssignment(obj, LABEL_PROPERTY);
  const label = labelProp
    ? labelProp.getInitializer()?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue()
    : undefined;

  return Ok(label ? { value: valueResult.value, label } : { value: valueResult.value });
};

const extractFromSpreadElement = (
  spread: SpreadElement,
  checker: TypeChecker
): Result<
  { values: readonly (string | number | boolean)[]; labels: Record<string, string> },
  EvaluationError
> => {
  const expr = spread.getExpression();
  if (expr.getKind() !== SyntaxKind.Identifier) {
    return Err(createEvaluationError('Spread element must be an identifier', spread));
  }

  const identifier = expr.asKindOrThrow(SyntaxKind.Identifier);
  const symbol = identifier.getSymbol() ?? checker.getSymbolAtLocation(identifier);
  const valueDecl = symbol?.getValueDeclaration();

  const init =
    valueDecl && 'getInitializer' in valueDecl
      ? (valueDecl as { getInitializer: () => Node | undefined }).getInitializer()
      : undefined;

  if (!init) {
    return Err(
      createEvaluationError(`Cannot resolve spread element: ${identifier.getText()}`, spread)
    );
  }

  const spreadArray = init.asKind(SyntaxKind.ArrayLiteralExpression);
  if (!spreadArray) {
    return Err(
      createEvaluationError('Spread element does not resolve to an array literal', spread)
    );
  }

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

  return Ok({ values: Object.freeze(values), labels });
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
