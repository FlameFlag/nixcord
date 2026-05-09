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
  tryEvaluate,
} from '../foundation/index.js';
import { NAME_PROPERTY, DESCRIPTION_PROPERTY } from './constants.js';
import { findDefinePluginCall } from '../navigator/plugin-navigator.js';
import { extractSelectOptions } from './select/index.js';
import { tsTypeToNixType } from '../parser.js';
import { resolveDefaultValue, isBareComponentSetting } from './default-value-resolution.js';
import type { PluginSetting, PluginConfig } from '@nixcord/shared';

const BOOLEAN_NIX_TYPE = 'types.bool';

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
        if (isBareComponentSetting(valueObj)) return acc;

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
        const typeResult = tsTypeToNixType(rawSetting, program, checker);
        const defaultResolution = resolveDefaultValue(
          valueObj,
          typeResult.nixType,
          props.defaultLiteralValue,
          typeResult.enumValues,
          checker
        );

        acc[key] = buildPluginSetting(
          key,
          defaultResolution.finalNixType,
          props.description,
          defaultResolution.defaultValue,
          typeResult.enumValues,
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

const extractGeneratedSettingsFromObjectEntriesReduce = (
  arg: Node,
  checker: TypeChecker,
  program: Program,
  skipHiddenCheck: boolean
): Record<string, PluginSetting | PluginConfig> => {
  const call = arg.asKind(SyntaxKind.CallExpression);
  const propAccess = call?.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
  if (!call || !propAccess || propAccess.getName() !== 'reduce') return {};

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
    return {};
  }

  const sourceObj = objectEntriesCall.getArguments()[0]?.asKind(SyntaxKind.Identifier);
  if (!sourceObj) return {};
  const sourceInit = sourceObj
    .getSymbol()
    ?.getValueDeclaration()
    ?.asKind(SyntaxKind.VariableDeclaration)
    ?.getInitializer()
    ?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!sourceInit) return {};

  const reducer = call.getArguments()[0]?.asKind(SyntaxKind.ArrowFunction);
  const assignment = reducer
    ?.getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .find((expr) => expr.getOperatorToken().getKind() === SyntaxKind.EqualsToken);
  const settingTemplate = assignment?.getRight().asKind(SyntaxKind.ObjectLiteralExpression);
  if (!settingTemplate) return {};

  const typeInit = getPropertyInitializer(settingTemplate, 'type');
  const defaultInit = getPropertyInitializer(settingTemplate, 'default');
  const defaultValue = extractLiteralValue(defaultInit, checker);
  const templateType = typeInit
    ? tsTypeToNixType({ type: typeInit, default: defaultValue }, program, checker).nixType
    : undefined;

  const result: Record<string, PluginSetting | PluginConfig> = {};
  for (const prop of iteratePropertyAssignments(sourceInit)) {
    const key = prop.getName();
    const sourceValue = prop.getInitializer()?.asKind(SyntaxKind.ObjectLiteralExpression);
    const description = sourceValue
      ? extractStringLiteralValue(sourceValue, DESCRIPTION_PROPERTY)
      : undefined;
    const finalType = templateType ?? BOOLEAN_NIX_TYPE;
    const defaultResolution = resolveDefaultValue(
      settingTemplate,
      finalType,
      defaultValue,
      undefined,
      checker
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

  return skipHiddenCheck ? result : result;
};

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
  if (arg.getKind() === SyntaxKind.ObjectLiteralExpression) {
    return extractSettingsFromObject(
      arg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression),
      checker,
      program,
      skipHiddenCheck
    );
  }
  return extractGeneratedSettingsFromObjectEntriesReduce(arg, checker, program, skipHiddenCheck);
}
