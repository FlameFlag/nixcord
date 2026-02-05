import type {
  TypeChecker,
  Program,
  ObjectLiteralExpression,
  PropertyAssignment,
  Node,
  SourceFile,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';

import {
  extractStringLiteralValue,
  iteratePropertyAssignments,
  getPropertyInitializer,
} from '../utils/node-helpers.js';
import { NAME_PROPERTY, DESCRIPTION_PROPERTY } from './constants.js';
import { findDefinePluginCall } from '../navigator/plugin-navigator.js';
import { extractSelectOptions } from './select/index.js';
import { tsTypeToNixType } from '../parser.js';
import { resolveDefaultValue } from './default-value-resolution.js';
import { tryEvaluate } from '../foundation.js';
import type { PluginSetting, PluginConfig } from '@nixcord/shared';

const extractLiteralValue = (node: Node | undefined, checker: TypeChecker): unknown => {
  if (!node) return undefined;

  const kind = node.getKind();
  if (kind === SyntaxKind.BigIntLiteral) {
    const raw = node.asKindOrThrow(SyntaxKind.BigIntLiteral).getText();
    return raw.toLowerCase().endsWith('n') ? raw.slice(0, -1) : raw;
  }
  if (kind === SyntaxKind.ArrayLiteralExpression) {
    const arr = node.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
    return arr.getElements().map((el) => extractLiteralValue(el, checker));
  }
  return tryEvaluate(node, checker);
};

const extractProperties = (valueObj: ObjectLiteralExpression, checker: TypeChecker) => {
  const typeNode = getPropertyInitializer(valueObj, 'type');
  const description =
    extractStringLiteralValue(valueObj, DESCRIPTION_PROPERTY) ??
    extractStringLiteralValue(valueObj, NAME_PROPERTY);
  const placeholder = extractStringLiteralValue(valueObj, 'placeholder');
  const restartNeededInit = getPropertyInitializer(valueObj, 'restartNeeded');
  const restartNeeded =
    restartNeededInit !== undefined
      ? restartNeededInit.getKind() === SyntaxKind.TrueKeyword
      : false;
  const hidden =
    valueObj
      .getProperty('hidden')
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.getKind() === SyntaxKind.TrueKeyword;
  const defaultLiteralValue = extractLiteralValue(
    getPropertyInitializer(valueObj, 'default'),
    checker
  );
  return { typeNode, description, placeholder, restartNeeded, hidden, defaultLiteralValue };
};

const buildPluginSetting = (
  key: string,
  finalNixType: string,
  description: string | undefined,
  defaultValue: unknown,
  selectEnumValues: readonly (string | number | boolean)[] | undefined,
  enumLabels: unknown,
  placeholder: string | undefined,
  hidden: boolean,
  restartNeeded: boolean
): PluginSetting => ({
  name: key,
  type: finalNixType,
  description: description
    ? restartNeeded
      ? `${description} (restart required)`
      : description
    : undefined,
  default: defaultValue,
  enumValues: selectEnumValues && selectEnumValues.length > 0 ? selectEnumValues : undefined,
  enumLabels:
    enumLabels && Object.keys(enumLabels as object).length > 0
      ? (enumLabels as Record<string, string>)
      : undefined,
  example: placeholder ?? undefined,
  hidden: hidden || undefined,
  restartNeeded,
});

const isSettingsGroup = (nestedProperties: readonly PropertyAssignment[]): boolean => {
  const hasTypeProperty = nestedProperties.some(
    (p) => p.getName() === 'type' || p.getName() === 'description'
  );
  const hasNestedSettings = nestedProperties.some(
    (p) => p.getInitializer()?.getKind() === SyntaxKind.ObjectLiteralExpression
  );
  return hasNestedSettings && !hasTypeProperty;
};

export function extractSettingsFromPropertyIterable(
  properties: Iterable<PropertyAssignment>,
  checker: TypeChecker,
  program: Program,
  skipHiddenCheck = false
): Record<string, PluginSetting | PluginConfig> {
  return Array.from(properties)
    .filter((propAssignment) => {
      const key = propAssignment.getName();
      const init = propAssignment.getInitializer();
      if (!key || !init || init.getKind() !== SyntaxKind.ObjectLiteralExpression) return false;
      const valueObj = init.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
      return (
        skipHiddenCheck ||
        valueObj
          .getProperty('hidden')
          ?.asKind(SyntaxKind.PropertyAssignment)
          ?.getInitializer()
          ?.getKind() !== SyntaxKind.TrueKeyword
      );
    })
    .reduce(
      (acc, propAssignment) => {
        const key = propAssignment.getName();
        const valueObj = propAssignment
          .getInitializer()!
          .asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
        const nestedProperties = Array.from(iteratePropertyAssignments(valueObj));

        if (isSettingsGroup(nestedProperties)) {
          acc[key] = {
            name: key,
            settings: extractSettingsFromPropertyIterable(
              nestedProperties,
              checker,
              program,
              skipHiddenCheck
            ) as Record<string, PluginSetting>,
          };
          return acc;
        }

        const props = extractProperties(valueObj, checker);
        if (!skipHiddenCheck && props.hidden) return acc;

        const optionsResult = extractSelectOptions(valueObj, checker);
        const extractedOptions = optionsResult.ok ? optionsResult.value.values : undefined;
        const extractedLabels = optionsResult.ok ? optionsResult.value.labels : undefined;

        const rawSetting = {
          type: props.typeNode,
          description: props.description,
          default: props.defaultLiteralValue,
          placeholder: props.placeholder,
          restartNeeded: props.restartNeeded,
          hidden: props.hidden,
          options: extractedOptions,
        };
        const { nixType: finalNixType, enumValues: selectEnumValues } = tsTypeToNixType(
          rawSetting,
          program,
          checker
        );
        const { finalNixType: resolvedNixType, defaultValue } = resolveDefaultValue(
          valueObj,
          finalNixType,
          props.defaultLiteralValue,
          selectEnumValues,
          checker
        );

        acc[key] = buildPluginSetting(
          key,
          resolvedNixType,
          props.description,
          defaultValue,
          selectEnumValues,
          extractedLabels,
          props.placeholder,
          props.hidden,
          props.restartNeeded
        );
        return acc;
      },
      {} as Record<string, PluginSetting | PluginConfig>
    );
}

export function extractSettingsFromObject(
  objExpr: ObjectLiteralExpression,
  checker: TypeChecker,
  program: Program,
  skipHiddenCheck = false
): Record<string, PluginSetting | PluginConfig> {
  return extractSettingsFromPropertyIterable(
    iteratePropertyAssignments(objExpr),
    checker,
    program,
    skipHiddenCheck
  );
}

export function extractSettingsFromCall(
  callExpr: Node | undefined,
  checker: TypeChecker,
  program: Program,
  skipHiddenCheck = false
): Record<string, PluginSetting | PluginConfig> {
  if (!callExpr || callExpr.getKind() !== SyntaxKind.CallExpression) return {};
  const expr = callExpr.asKindOrThrow(SyntaxKind.CallExpression);
  const args = expr.getArguments();
  if (args.length === 0) return {};
  const arg = args[0];
  if (arg.getKind() !== SyntaxKind.ObjectLiteralExpression) return {};
  return extractSettingsFromObject(
    arg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression),
    checker,
    program,
    skipHiddenCheck
  );
}
