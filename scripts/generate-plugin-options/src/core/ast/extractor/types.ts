/**
 * Types for extractor return values and intermediate results.
 */

import { Result } from 'true-myth';
import { z } from 'zod';
import type { ReadonlyDeep } from 'type-fest';
import type { Node } from 'ts-morph';
import type { EnumLiteral } from './constants.js';

/**
 * Possible default values that can be extracted from plugin settings.
 * Function calls and getters return undefined as they cannot be statically evaluated.
 * Complex expressions may also return undefined if they cannot be resolved.
 */
export type ExtractedDefaultValue =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | readonly unknown[]
  | Record<string, unknown>
  | undefined;

/**
 * Zod schema for validating extracted plugin information.
 */
export const ExtractedPluginInfoSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  isModified: z.boolean().optional(),
});

/**
 * Plugin information extracted from definePlugin call.
 * Contains the plugin name and description if available.
 */
export interface ExtractedPluginInfo extends ReadonlyDeep<
  z.infer<typeof ExtractedPluginInfoSchema>
> {}

/**
 * Error types for extraction failures.
 */
export enum ExtractionErrorKind {
  /** Property not found */
  MissingProperty = 'MissingProperty',
  /** Expression cannot be statically evaluated */
  CannotEvaluate = 'CannotEvaluate',
  /** Symbol cannot be resolved */
  UnresolvableSymbol = 'UnresolvableSymbol',
  /** Type inference failed */
  TypeInferenceFailed = 'TypeInferenceFailed',
  /** Pattern not supported */
  UnsupportedPattern = 'UnsupportedPattern',
  /** Invalid node type */
  InvalidNodeType = 'InvalidNodeType',
}

/**
 * Structured error information for extraction failures.
 */
export interface ExtractionError {
  readonly kind: ExtractionErrorKind;
  readonly message: string;
  readonly node?: Node | undefined;
  readonly context?: Record<string, unknown> | undefined;
}

/**
 * Creates an extraction error.
 */
export function createExtractionError(
  kind: ExtractionErrorKind,
  message: string,
  node?: Node | undefined,
  context?: Record<string, unknown> | undefined
): ExtractionError {
  return { kind, message, node, context };
}

export const extractionErrors = {
  invalidNodeType: (expected: string, node: Node): SelectOptionsResult =>
    Result.err(
      createExtractionError(ExtractionErrorKind.InvalidNodeType, `Expected ${expected}`, node)
    ),
  missingProperty: (propName: string, node: Node): SelectOptionsResult =>
    Result.err(
      createExtractionError(
        ExtractionErrorKind.MissingProperty,
        `Missing '${propName}' property`,
        node
      )
    ),
  unresolvableSymbol: (symbolName: string, node: Node): SelectOptionsResult =>
    Result.err(
      createExtractionError(
        ExtractionErrorKind.UnresolvableSymbol,
        `Cannot resolve symbol: ${symbolName}`,
        node
      )
    ),
  unsupportedPattern: (pattern: string, node: Node): SelectOptionsResult =>
    Result.err(createExtractionError(ExtractionErrorKind.UnsupportedPattern, pattern, node)),
  cannotEvaluate: (reason: string, node: Node): SelectOptionsResult =>
    Result.err(createExtractionError(ExtractionErrorKind.CannotEvaluate, reason, node)),
};

export function createSelectOptionsResult(
  values: readonly EnumLiteral[],
  labels: Record<string, string> = {}
): SelectOptionsResult {
  return Result.ok({
    values: Object.freeze(values),
    labels: Object.freeze(labels) as ReadonlyDeep<Record<string, string>>,
  });
}

/**
 * Result type for default value extraction.
 * - Success with value: Property found and extracted
 * - Success with undefined: Property not found (valid state)
 * - Error: Extraction failed (evaluation error, etc.)
 */
export type DefaultValueResult = Result<ExtractedDefaultValue, ExtractionError>;

/**
 * Result type for enum value resolution.
 * - Success: Enum literal resolved
 * - Error: Could not resolve (unresolvable symbol, etc.)
 */
export type EnumValueResult = Result<EnumLiteral, ExtractionError>;

/**
 * Options with their labels (if available)
 */
export interface SelectOptionsWithLabels {
  readonly values: readonly EnumLiteral[];
  readonly labels: ReadonlyDeep<Record<string, string> & Partial<Record<number, string>>>;
}

/**
 * Result type for select options extraction.
 * - Success with options: Options extracted (empty array if none found)
 * - Error: Extraction failed
 */
export type SelectOptionsResult = Result<SelectOptionsWithLabels, ExtractionError>;

/**
 * Result type for select default extraction.
 * - Success with value: Default found
 * - Success with undefined: No default specified (valid)
 * - Error: Extraction failed
 */
export type SelectDefaultResult = Result<EnumLiteral | undefined, ExtractionError>;
