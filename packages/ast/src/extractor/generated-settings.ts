import type { PluginConfig, PluginSetting } from '@nixcord/shared';
import type { ArrowFunction, CallExpression, Node } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { extractStringLiteralValue, getPropertyInitializer } from '../foundation/index.js';
import { tsTypeToNixType } from '../parser.js';
import { type BoundValue, bindingsForMapItem } from './bindings.js';
import { DESCRIPTION_PROPERTY, NIX_TYPE_BOOL } from './constants.js';
import {
  type ExtractionContext,
  mergeSettingsResults,
  settingsResult,
  skippedSetting,
  skipResult,
  unsupportedResult,
  unsupportedSetting,
  withBindings,
} from './context.js';
import { resolveDefaultValue } from './default-value-resolution.js';
import {
  extractLiteralValue,
  extractSettingKey,
  extractStringPropertyValue,
} from './literal-value.js';
import {
  buildPluginSetting,
  getReturnedExpression,
  resolveArrayLiteral,
  resolveObjectLiteral,
} from './setting-shape.js';
import type { ExtractedSettings, ExtractionResult } from './types.js';

type GeneratedSettingPair = {
  key: string;
  value: Node;
  context: ExtractionContext;
};

type GeneratedSettingExtractor = (
  pair: GeneratedSettingPair,
  skipHiddenCheck: boolean
) => ExtractionResult<ExtractedSettings>;

const isHiddenSetting = (valueObj: Node): boolean =>
  valueObj
    .asKind(SyntaxKind.ObjectLiteralExpression)
    ?.getProperty('hidden')
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.getKind() === SyntaxKind.TrueKeyword;

const extractGeneratedSettingPair = (
  arrow: ArrowFunction,
  item: BoundValue | readonly BoundValue[],
  context: ExtractionContext
): GeneratedSettingPair | undefined => {
  const bindings = bindingsForMapItem(arrow, item);
  const body = getReturnedExpression(arrow.getBody());
  const tuple = body?.asKind(SyntaxKind.ArrayLiteralExpression);
  if (!tuple) return undefined;

  const [keyNode, valueNode] = tuple.getElements();
  const key = extractSettingKey(keyNode, context.checker, bindings);
  if (!key || !valueNode) return undefined;

  return { key, value: valueNode, context: withBindings(context, bindings) };
};

const getObjectEntriesSource = (
  node: Node,
  context: ExtractionContext
): import('ts-morph').ObjectLiteralExpression | undefined => {
  const call = node.asKind(SyntaxKind.CallExpression);
  const propAccess = call?.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
  if (!call || !propAccess) return undefined;
  if (propAccess.getExpression().getText() !== 'Object' || propAccess.getName() !== 'entries') {
    return undefined;
  }
  return resolveObjectLiteral(call.getArguments()[0], context.checker);
};

const extractGeneratedSettingsFromMap = (
  mapCall: CallExpression,
  context: ExtractionContext,
  skipHiddenCheck: boolean,
  extractGeneratedSetting: GeneratedSettingExtractor
): ExtractionResult<ExtractedSettings> => {
  const mapAccess = mapCall.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
  if (!mapAccess || mapAccess.getName() !== 'map') {
    return unsupportedResult(
      unsupportedSetting(
        'unsupported-generated-settings-pattern',
        `Unsupported generated settings pattern: ${mapCall.getExpression().getText()}`,
        mapCall,
        undefined,
        'Object.fromEntries(...map(...))'
      )
    );
  }

  const arrow = mapCall.getArguments()[0]?.asKind(SyntaxKind.ArrowFunction);
  if (!arrow) {
    return unsupportedResult(
      unsupportedSetting(
        'unsupported-generated-settings-pattern',
        'Object.fromEntries map callback is not a supported arrow function',
        mapCall,
        undefined,
        'Object.fromEntries(...map(...))'
      )
    );
  }

  const mapSource = mapAccess.getExpression();
  const results: ExtractionResult<ExtractedSettings>[] = [];
  const objectEntriesSource = getObjectEntriesSource(mapSource, context);

  if (objectEntriesSource) {
    for (const prop of objectEntriesSource.getProperties()) {
      const propAssignment = prop.asKind(SyntaxKind.PropertyAssignment);
      const init = propAssignment?.getInitializer();
      if (!propAssignment || !init) continue;
      const pair = extractGeneratedSettingPair(arrow, [propAssignment.getName(), init], context);
      if (!pair) continue;
      results.push(extractGeneratedSetting(pair, skipHiddenCheck));
    }
    return mergeSettingsResults(...results);
  }

  const arraySource = resolveArrayLiteral(mapSource, context.checker);
  if (!arraySource) {
    return unsupportedResult(
      unsupportedSetting(
        'unsupported-generated-settings-pattern',
        `Could not resolve generated settings map source: ${mapSource.getText()}`,
        mapSource,
        undefined,
        'Object.fromEntries(...map(...))'
      )
    );
  }

  for (const element of arraySource.getElements()) {
    const pair = extractGeneratedSettingPair(arrow, element, context);
    if (!pair) continue;
    results.push(extractGeneratedSetting(pair, skipHiddenCheck));
  }

  return mergeSettingsResults(...results);
};

export const extractSettingsFromObjectFromEntries = (
  call: CallExpression,
  context: ExtractionContext,
  skipHiddenCheck: boolean,
  extractGeneratedSetting: GeneratedSettingExtractor
): ExtractionResult<ExtractedSettings> => {
  const propAccess = call.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
  if (
    !propAccess ||
    propAccess.getExpression().getText() !== 'Object' ||
    propAccess.getName() !== 'fromEntries'
  ) {
    return unsupportedResult(
      unsupportedSetting(
        'unsupported-generated-settings-pattern',
        `Unsupported generated settings pattern: ${call.getExpression().getText()}`,
        call,
        undefined,
        'Object.fromEntries(...map(...))'
      )
    );
  }

  const mapCall = call.getArguments()[0]?.asKind(SyntaxKind.CallExpression);
  return mapCall
    ? extractGeneratedSettingsFromMap(mapCall, context, skipHiddenCheck, extractGeneratedSetting)
    : unsupportedResult(
        unsupportedSetting(
          'unsupported-generated-settings-pattern',
          'Object.fromEntries argument is not a supported map call',
          call,
          undefined,
          'Object.fromEntries(...map(...))'
        )
      );
};

export const extractGeneratedSettingsFromObjectEntriesReduce = (
  arg: Node,
  context: ExtractionContext,
  skipHiddenCheck: boolean
): ExtractionResult<ExtractedSettings> => {
  const call = arg.asKind(SyntaxKind.CallExpression);
  const propAccess = call?.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
  if (!call || !propAccess || propAccess.getName() !== 'reduce') {
    return unsupportedResult(
      unsupportedSetting(
        'unsupported-generated-settings-pattern',
        `Unsupported settings argument: ${arg.getText()}`,
        arg,
        undefined,
        'Object.entries(...).reduce(...)'
      )
    );
  }

  const objectEntriesCall = propAccess.getExpression().asKind(SyntaxKind.CallExpression);
  const objectEntriesAccess = objectEntriesCall
    ?.getExpression()
    .asKind(SyntaxKind.PropertyAccessExpression);
  if (
    !objectEntriesCall ||
    !objectEntriesAccess ||
    objectEntriesAccess.getExpression().getText() !== 'Object' ||
    objectEntriesAccess.getName() !== 'entries'
  ) {
    return unsupportedResult(
      unsupportedSetting(
        'unsupported-generated-settings-pattern',
        `Unsupported generated settings reduce source: ${propAccess.getExpression().getText()}`,
        propAccess.getExpression(),
        undefined,
        'Object.entries(...).reduce(...)'
      )
    );
  }

  const sourceInit = resolveObjectLiteral(objectEntriesCall.getArguments()[0], context.checker);
  if (!sourceInit) {
    return unsupportedResult(
      unsupportedSetting(
        'unsupported-generated-settings-pattern',
        `Could not resolve Object.entries source: ${objectEntriesCall.getArguments()[0]?.getText()}`,
        objectEntriesCall,
        undefined,
        'Object.entries(...).reduce(...)'
      )
    );
  }

  const reducer = call.getArguments()[0]?.asKind(SyntaxKind.ArrowFunction);
  const assignment = reducer
    ?.getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .find((expr) => expr.getOperatorToken().getKind() === SyntaxKind.EqualsToken);
  const settingTemplate = assignment?.getRight().asKind(SyntaxKind.ObjectLiteralExpression);
  if (!settingTemplate) {
    return unsupportedResult(
      unsupportedSetting(
        'unsupported-generated-settings-pattern',
        'Object.entries reduce callback does not assign a supported setting object template',
        call,
        undefined,
        'Object.entries(...).reduce(...)'
      )
    );
  }
  if (!skipHiddenCheck && isHiddenSetting(settingTemplate)) {
    return skipResult(
      skippedSetting(
        'hidden-setting-skipped',
        '<generated>',
        'Skipped hidden generated settings template',
        settingTemplate,
        'Object.entries(...).reduce(...)'
      )
    );
  }

  const typeInit = getPropertyInitializer(settingTemplate, 'type');
  const defaultInit = getPropertyInitializer(settingTemplate, 'default');
  const defaultValue = extractLiteralValue(defaultInit, context.checker);
  const templateType = typeInit
    ? tsTypeToNixType({ type: typeInit, default: defaultValue }, context.program, context.checker)
        .nixType
    : undefined;

  const result: Record<string, PluginSetting | PluginConfig> = {};
  for (const prop of sourceInit.getProperties()) {
    const propAssignment = prop.asKind(SyntaxKind.PropertyAssignment);
    if (!propAssignment) continue;
    const key = propAssignment.getName();
    const sourceValue = propAssignment.getInitializer()?.asKind(SyntaxKind.ObjectLiteralExpression);
    const description = sourceValue
      ? (extractStringLiteralValue(sourceValue, DESCRIPTION_PROPERTY) ??
        extractStringPropertyValue(sourceValue, DESCRIPTION_PROPERTY, context.checker))
      : undefined;
    const finalType = templateType ?? NIX_TYPE_BOOL;
    const defaultResolution = resolveDefaultValue(
      settingTemplate,
      finalType,
      defaultValue,
      undefined,
      context.checker
    );
    result[key] = buildPluginSetting(
      key,
      defaultResolution.finalNixType,
      description,
      defaultResolution.defaultValue,
      undefined,
      undefined,
      undefined,
      false,
      false
    );
  }

  return settingsResult(result);
};
