import type { PluginSetting } from '@nixcord/shared';
import type {
  ArrowFunction,
  CallExpression,
  Node,
  ObjectLiteralExpression,
  PropertyAssignment,
  TypeChecker,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import {
  getPropertyInitializer,
  resolveCallExpressionReturn,
  resolveIdentifierInitializerNode,
  resolveValueDeclaration,
  unwrapNode,
} from '../foundation/index.js';

export { getReturnedExpression } from '../foundation/index.js';

import { bindingsForCallParameters, type ParameterBindings } from './bindings.js';
import {
  DESCRIPTION_PROPERTY,
  NAME_PROPERTY,
  NIX_TYPE_ATTRS,
  NIX_TYPE_BOOL,
  NIX_TYPE_FLOAT,
  NIX_TYPE_INT,
  NIX_TYPE_LIST_OF_STR,
  NIX_TYPE_STR,
} from './constants.js';
import {
  extractLiteralUnionValues,
  extractLiteralValue,
  extractStringPropertyValue,
} from './literal-value.js';

export const inferSettingTypeFromDefault = (defaultValue: unknown): string => {
  if (typeof defaultValue === 'boolean') return NIX_TYPE_BOOL;
  if (typeof defaultValue === 'number')
    return Number.isInteger(defaultValue) ? NIX_TYPE_INT : NIX_TYPE_FLOAT;
  if (typeof defaultValue === 'string') return NIX_TYPE_STR;
  if (Array.isArray(defaultValue)) {
    return defaultValue.every((item) => typeof item === 'string')
      ? NIX_TYPE_LIST_OF_STR
      : NIX_TYPE_ATTRS;
  }
  return NIX_TYPE_ATTRS;
};

export const buildPluginSetting = (
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

const getArrowFunctionForCall = (
  call: CallExpression,
  checker: TypeChecker
): ArrowFunction | undefined => {
  const ident = call.getExpression().asKind(SyntaxKind.Identifier);
  if (!ident) return undefined;

  const valueDecl = resolveValueDeclaration(ident, checker);
  return (
    valueDecl?.asKind(SyntaxKind.ArrowFunction) ??
    valueDecl
      ?.asKind(SyntaxKind.VariableDeclaration)
      ?.getInitializer()
      ?.asKind(SyntaxKind.ArrowFunction) ??
    ident
      .getSourceFile()
      .getVariableDeclaration(ident.getText())
      ?.getInitializer()
      ?.asKind(SyntaxKind.ArrowFunction)
  );
};

export const resolveSettingValueObject = (
  init: Node,
  checker: TypeChecker,
  outerBindings?: ParameterBindings
): { valueObj: ObjectLiteralExpression; bindings?: ParameterBindings } | undefined => {
  const directObject = unwrapNode(init).asKind(SyntaxKind.ObjectLiteralExpression);
  if (directObject) return { valueObj: directObject, bindings: outerBindings };

  const call = init.asKind(SyntaxKind.CallExpression);
  if (!call) return undefined;

  const arrow = getArrowFunctionForCall(call, checker);
  const bodyObject = arrow
    ? unwrapNode(arrow.getBody()).asKind(SyntaxKind.ObjectLiteralExpression)
    : undefined;
  if (arrow && bodyObject) {
    const args = call.getArguments();
    const bindings = bindingsForCallParameters(arrow.getParameters(), args, outerBindings);
    return { valueObj: bodyObject, bindings };
  }

  const resolved = resolveCallExpressionReturn(call, checker);
  const resolvedObject = resolved
    ? unwrapNode(resolved).asKind(SyntaxKind.ObjectLiteralExpression)
    : undefined;
  return resolvedObject ? { valueObj: resolvedObject, bindings: outerBindings } : undefined;
};

export const extractProperties = (
  valueObj: ObjectLiteralExpression,
  checker: TypeChecker,
  bindings?: ParameterBindings
) => {
  const typeNode = getPropertyInitializer(valueObj, 'type');
  const description =
    extractStringPropertyValue(valueObj, DESCRIPTION_PROPERTY, checker, bindings) ??
    extractStringPropertyValue(valueObj, NAME_PROPERTY, checker, bindings);
  const placeholder = extractStringPropertyValue(valueObj, 'placeholder', checker, bindings);
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
  const defaultInitializer = getPropertyInitializer(valueObj, 'default');
  const defaultLiteralValue = extractLiteralValue(defaultInitializer, checker, bindings);
  const typeAssertionEnumValues = extractLiteralUnionValues(defaultInitializer, checker);
  return {
    typeNode,
    description,
    placeholder,
    restartNeeded,
    hidden,
    defaultLiteralValue,
    typeAssertionEnumValues,
  };
};

export const isSettingsGroup = (nestedProperties: readonly PropertyAssignment[]): boolean => {
  const hasTypeProperty = nestedProperties.some(
    (p) => p.getName() === 'type' || p.getName() === 'description'
  );
  const hasNestedSettings = nestedProperties.some(
    (p) => p.getInitializer()?.getKind() === SyntaxKind.ObjectLiteralExpression
  );
  return hasNestedSettings && !hasTypeProperty;
};

export const resolveArrayLiteral = (
  node: Node | undefined,
  checker: TypeChecker
): import('ts-morph').ArrayLiteralExpression | undefined => {
  if (!node) return undefined;
  const unwrapped = unwrapNode(node);
  const directArray = unwrapped.asKind(SyntaxKind.ArrayLiteralExpression);
  if (directArray) return directArray;

  const ident = unwrapped.asKind(SyntaxKind.Identifier);
  if (ident) return resolveArrayLiteral(resolveIdentifierInitializerNode(ident, checker), checker);

  const binExpr = unwrapped.asKind(SyntaxKind.BinaryExpression);
  if (
    binExpr &&
    [SyntaxKind.BarBarToken, SyntaxKind.QuestionQuestionToken].includes(
      binExpr.getOperatorToken().getKind()
    )
  ) {
    return (
      resolveArrayLiteral(binExpr.getLeft(), checker) ??
      resolveArrayLiteral(binExpr.getRight(), checker)
    );
  }

  return undefined;
};

export const resolveObjectLiteral = (
  node: Node | undefined,
  checker: TypeChecker
): ObjectLiteralExpression | undefined => {
  if (!node) return undefined;
  const unwrapped = unwrapNode(node);
  const directObject = unwrapped.asKind(SyntaxKind.ObjectLiteralExpression);
  if (directObject) return directObject;

  const ident = unwrapped.asKind(SyntaxKind.Identifier);
  if (ident) return resolveObjectLiteral(resolveIdentifierInitializerNode(ident, checker), checker);

  return undefined;
};
