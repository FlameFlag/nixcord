/**
 * Plugin-specific navigation functions.
 *
 * Uses generic navigator utilities to find plugin-related nodes.
 * Still pure navigation - doesn't extract values, just finds nodes.
 */

import type { SourceFile, CallExpression } from 'ts-morph';
import {
  findCallExpressionByName,
  findCallExpressionByNameUnwrappingChains,
} from './pattern-matcher.js';
import {
  DEFINE_PLUGIN_FUNCTION_NAME,
  DEFINE_PLUGIN_SETTINGS_FUNCTION_NAME,
} from '../extractor/constants.js';

/**
 * Finds the definePlugin call expression in a source file.
 * Pure navigation - returns the node, doesn't extract values.
 */
export function findDefinePluginCall(sourceFile: SourceFile): CallExpression | undefined {
  return findCallExpressionByName(sourceFile, DEFINE_PLUGIN_FUNCTION_NAME);
}

/**
 * Finds the definePluginSettings call expression in a source file.
 *
 * Handles chained calls like `definePluginSettings({...}).withPrivateSettings<{...}>()`.
 * Returns the inner `definePluginSettings()` CallExpression, not the outer chained call.
 *
 * This is pure navigation - it finds the node but doesn't extract values from it.
 */
export function findDefinePluginSettings(sourceFile: SourceFile): CallExpression | undefined {
  return findCallExpressionByNameUnwrappingChains(
    sourceFile,
    DEFINE_PLUGIN_SETTINGS_FUNCTION_NAME,
    ['withPrivateSettings']
  );
}
