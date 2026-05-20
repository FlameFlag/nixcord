/**
 * Plugin-specific navigation functions.
 *
 * Uses generic navigator utilities to find plugin-related nodes.
 * Still pure navigation - doesn't extract values, just finds nodes.
 */

import type { CallExpression, SourceFile } from 'ts-morph';
import {
  DEFINE_PLUGIN_FUNCTION_NAME,
  DEFINE_PLUGIN_SETTINGS_FUNCTION_NAME,
  MIGRATE_PLUGIN_SETTING_FUNCTION_NAME,
  MIGRATE_PLUGIN_SETTINGS_FUNCTION_NAME,
} from '../extractor/constants.js';
import {
  findAllCallExpressionsByName,
  findCallExpressionByName,
  findCallExpressionByNameUnwrappingChains,
} from './pattern-matcher.js';

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

/**
 * Finds all migratePluginSetting() calls in a source file.
 * There can be multiple calls per file (one per renamed setting).
 */
export function findMigratePluginSettingCalls(sourceFile: SourceFile): CallExpression[] {
  return findAllCallExpressionsByName(sourceFile, MIGRATE_PLUGIN_SETTING_FUNCTION_NAME);
}

/**
 * Finds all migratePluginSettings() calls in a source file.
 * There can be multiple calls per file (one per renamed plugin group).
 */
export function findMigratePluginSettingsCalls(sourceFile: SourceFile): CallExpression[] {
  return findAllCallExpressionsByName(sourceFile, MIGRATE_PLUGIN_SETTINGS_FUNCTION_NAME);
}
