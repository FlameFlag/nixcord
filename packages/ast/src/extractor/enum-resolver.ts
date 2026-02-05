import type { TypeChecker, Node } from 'ts-morph';
import { Ok, Err } from '@nixcord/shared';
import { evaluate } from '../foundation.js';
import type { EnumValueResult } from './types.js';
import { createExtractionError, ExtractionErrorKind } from './types.js';

/**
 * Resolves an enum-like value from a TypeScript AST node.
 *
 * Delegates to the foundation evaluator which handles literals, enum members,
 * property access, binary expressions, and external enums. Returns the resolved
 * enum literal (string, number, or boolean) on success, or an error if it can't be evaluated.
 */
export function resolveEnumLikeValue(
  valueInitializer: Node,
  checker: TypeChecker
): EnumValueResult {
  const result = evaluate(valueInitializer, checker);

  if (result.ok) {
    return Ok(result.value);
  }

  return Err(
    createExtractionError(
      ExtractionErrorKind.CannotEvaluate,
      result.error.message,
      result.error.node
    )
  );
}
