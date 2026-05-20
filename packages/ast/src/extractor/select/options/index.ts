/**
 * SELECT options extraction - unified entry point.
 *
 * This module extracts available options for SELECT type settings from various patterns:
 * - Array literals: `options: ["a", "b"]` or `options: [{ value: "a" }, { value: "b" }]`
 * - Array.map(): `options: ["a", "b"].map(x => ({ value: x }))`
 * - Object.keys(): `options: Object.keys(config).map(...)`
 * - Object.values(): `options: Object.values(config).map(...)`
 * - Array.from(): `options: Array.from([...])`
 * - Theme patterns: `options: themeNames.map(name => ({ value: themes[name] }))`
 */

import { Err } from '@nixcord/shared';
import type {
  Node,
  ObjectLiteralExpression,
  PropertyAccessExpression,
  TypeChecker,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { resolveIdentifierInitializerNode, unwrapNode } from '../../../foundation/index.js';
import { METHOD_NAME_MAP, OPTIONS_PROPERTY } from '../../constants.js';
import type { SelectOptionsResult } from '../../types.js';
import {
  createExtractionError,
  createSelectOptionsResult,
  ExtractionErrorKind,
} from '../../types.js';
import { isArrayFromCall } from '../patterns/index.js';
import {
  extractOptionsFromArrayFrom,
  extractOptionsFromArrayMap,
  extractOptionsFromObjectArray,
} from './array-patterns.js';
import { extractOptionsFromObjectKeys, extractOptionsFromObjectValues } from './object-patterns.js';
import { extractOptionsFromThemePattern } from './theme-patterns.js';

const emptyOptions = (): SelectOptionsResult => createSelectOptionsResult([]);

const extractFromMapCall = (
  propExpr: PropertyAccessExpression,
  target: Node,
  call: Node,
  checker: TypeChecker
): SelectOptionsResult => {
  if (propExpr.getName() !== METHOD_NAME_MAP) {
    return Err(
      createExtractionError(
        ExtractionErrorKind.UnsupportedPattern,
        `Expected .map() call, got .${propExpr.getName()}()`,
        call
      )
    );
  }

  const arrayResult = extractOptionsFromArrayMap(target, checker);
  if (arrayResult.ok) return arrayResult;

  if (target.getKind() === SyntaxKind.CallExpression) {
    const keysResult = extractOptionsFromObjectKeys(target, checker);
    if (keysResult.ok) return keysResult;

    const valuesResult = extractOptionsFromObjectValues(target, checker);
    if (valuesResult.ok) return valuesResult;
  }

  const themeResult = extractOptionsFromThemePattern(target, call, checker);
  if (themeResult.ok) return themeResult;

  return Err(
    createExtractionError(ExtractionErrorKind.UnsupportedPattern, 'Unsupported map() pattern', call)
  );
};

const extractFromCallExpression = (call: Node, checker: TypeChecker): SelectOptionsResult => {
  const callExpr = call.asKind(SyntaxKind.CallExpression);
  if (!callExpr) {
    return Err(
      createExtractionError(ExtractionErrorKind.InvalidNodeType, 'Expected CallExpression', call)
    );
  }

  const expr = callExpr.getExpression();

  if (isArrayFromCall(call)) return extractOptionsFromArrayFrom(call, checker);

  const propExpr = expr.asKind(SyntaxKind.PropertyAccessExpression);
  if (!propExpr) {
    return Err(
      createExtractionError(ExtractionErrorKind.UnsupportedPattern, 'Expected method call', call)
    );
  }

  return extractFromMapCall(propExpr, propExpr.getExpression(), call, checker);
};

export function extractSelectOptions(
  node: ObjectLiteralExpression,
  checker: TypeChecker
): SelectOptionsResult {
  const prop = node.getProperty(OPTIONS_PROPERTY);
  if (!prop || prop.getKind() !== SyntaxKind.PropertyAssignment) return emptyOptions();

  const initializer = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
  if (!initializer) return emptyOptions();

  const initUnwrapped = unwrapNode(initializer);

  if (initUnwrapped.getKind() === SyntaxKind.ArrayLiteralExpression) {
    return extractOptionsFromObjectArray(
      initUnwrapped.asKindOrThrow(SyntaxKind.ArrayLiteralExpression),
      checker
    );
  }

  if (initUnwrapped.getKind() === SyntaxKind.CallExpression) {
    const result = extractFromCallExpression(initUnwrapped, checker);
    return result.ok ? result : emptyOptions();
  }

  if (initUnwrapped.getKind() === SyntaxKind.Identifier) {
    const resolved = resolveIdentifierInitializerNode(initUnwrapped, checker);
    if (resolved) {
      const resolvedUnwrapped = unwrapNode(resolved);
      if (resolvedUnwrapped.getKind() === SyntaxKind.ArrayLiteralExpression) {
        return extractOptionsFromObjectArray(
          resolvedUnwrapped.asKindOrThrow(SyntaxKind.ArrayLiteralExpression),
          checker
        );
      }
      if (resolvedUnwrapped.getKind() === SyntaxKind.CallExpression) {
        const result = extractFromCallExpression(resolvedUnwrapped, checker);
        return result.ok ? result : emptyOptions();
      }
    }
  }

  return emptyOptions();
}
