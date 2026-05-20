import type { PluginConfig, PluginSetting } from '@nixcord/shared';
import type {
  ArrowFunction,
  CallExpression,
  Node,
  ObjectLiteralExpression,
  Program,
  PropertyAssignment,
  SourceFile,
  Type,
  TypeChecker,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import type { EnumLiteral } from '../foundation/index.js';
import {
  extractStringLiteralValue,
  getPropertyInitializer,
  iteratePropertyAssignments,
  resolveCallExpressionReturn,
  tryEvaluate,
  unwrapNode,
} from '../foundation/index.js';
import { findDefinePluginCall } from '../navigator/plugin-navigator.js';
import { tsTypeToNixType } from '../parser.js';
import { DESCRIPTION_PROPERTY, NAME_PROPERTY } from './constants.js';
import { isBareComponentSetting, resolveDefaultValue } from './default-value-resolution.js';
import { extractSelectOptions } from './select/index.js';

const BOOLEAN_NIX_TYPE = 'types.bool';

type ParameterBindings = ReadonlyMap<string, Node>;

const extractLiteralValue = (
  node: Node | undefined,
  checker: TypeChecker,
  bindings?: ParameterBindings
): unknown => {
  if (!node) return undefined;

  const ident = node.asKind(SyntaxKind.Identifier);
  if (ident && bindings?.has(ident.getText())) {
    return extractLiteralValue(bindings.get(ident.getText()), checker);
  }

  const kind = node.getKind();
  if (kind === SyntaxKind.BigIntLiteral) {
    const raw = node.asKindOrThrow(SyntaxKind.BigIntLiteral).getText();
    return raw.toLowerCase().endsWith('n') ? raw.slice(0, -1) : raw;
  }
  if (kind === SyntaxKind.ArrayLiteralExpression) {
    const arr = node.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
    return arr.getElements().map((el) => extractLiteralValue(el, checker, bindings));
  }
  return tryEvaluate(node, checker);
};

const extractLiteralFromTypeNode = (node: Node): EnumLiteral | undefined => {
  const literalNode = node.asKind(SyntaxKind.LiteralType)?.getLiteral();
  if (!literalNode) return undefined;
  if (literalNode.getKind() === SyntaxKind.StringLiteral) {
    return literalNode.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();
  }
  if (literalNode.getKind() === SyntaxKind.NumericLiteral) {
    return literalNode.asKindOrThrow(SyntaxKind.NumericLiteral).getLiteralValue();
  }
  if (literalNode.getKind() === SyntaxKind.TrueKeyword) return true;
  if (literalNode.getKind() === SyntaxKind.FalseKeyword) return false;
  return undefined;
};

const extractLiteralUnionFromTypeNode = (node: Node): readonly EnumLiteral[] | undefined => {
  const unionNode = node.asKind(SyntaxKind.UnionType);
  if (unionNode) {
    const values = unionNode.getTypeNodes().map(extractLiteralFromTypeNode);
    return values.every((value): value is EnumLiteral => value !== undefined)
      ? Object.freeze(values)
      : undefined;
  }

  const typeRef = node.asKind(SyntaxKind.TypeReference);
  const typeName = typeRef?.getTypeName();
  if (typeName) {
    const symbol = typeName.getSymbol();
    const aliasedSymbol = symbol?.getAliasedSymbol();
    const declaration = aliasedSymbol?.getDeclarations()[0] ?? symbol?.getDeclarations()[0];
    const aliasTypeNode = declaration?.asKind(SyntaxKind.TypeAliasDeclaration)?.getTypeNode();
    return aliasTypeNode ? extractLiteralUnionFromTypeNode(aliasTypeNode) : undefined;
  }

  return undefined;
};

const extractLiteralUnionFromTypes = (
  unionTypes: readonly Type[],
  textNode: Node
): readonly EnumLiteral[] | undefined => {
  if (unionTypes.length === 0) return undefined;

  const values = unionTypes
    .map((unionType) => {
      if (unionType.isStringLiteral() || unionType.isNumberLiteral()) {
        return unionType.getLiteralValue();
      }
      if (unionType.isBooleanLiteral()) {
        const text = unionType.getText(textNode);
        if (text === 'true') return true;
        if (text === 'false') return false;
      }
      return undefined;
    })
    .filter((value): value is EnumLiteral =>
      ['string', 'number', 'boolean'].includes(typeof value)
    );

  return values.length === unionTypes.length ? Object.freeze(values) : undefined;
};

const extractLiteralUnionValues = (
  node: Node | undefined,
  checker: TypeChecker
): readonly EnumLiteral[] | undefined => {
  if (!node) return undefined;
  const typeNode = node.asKind(SyntaxKind.AsExpression)?.getTypeNode();
  if (!typeNode) return undefined;

  const staticValues = extractLiteralUnionFromTypeNode(typeNode);
  if (staticValues) return staticValues;

  try {
    const type = checker.getTypeAtLocation(typeNode);
    const unionTypes = type.getUnionTypes();
    const values = extractLiteralUnionFromTypes(unionTypes, typeNode);
    if (values) return values;
  } catch {}

  try {
    const type = checker.getTypeAtLocation(node);
    const unionTypes = type.getUnionTypes();
    return extractLiteralUnionFromTypes(unionTypes, node);
  } catch {
    return undefined;
  }
};

const extractStringPropertyValue = (
  valueObj: ObjectLiteralExpression,
  propName: string,
  checker: TypeChecker,
  bindings?: ParameterBindings
): string | undefined => {
  const literalValue = extractStringLiteralValue(valueObj, propName);
  if (literalValue !== undefined) return literalValue;

  const shorthand = valueObj.getProperty(propName)?.asKind(SyntaxKind.ShorthandPropertyAssignment);
  const shorthandValue = extractLiteralValue(
    bindings?.get(shorthand?.getName() ?? ''),
    checker,
    bindings
  );
  if (typeof shorthandValue === 'string') return shorthandValue;

  const init = getPropertyInitializer(valueObj, propName);
  const ident = init?.asKind(SyntaxKind.Identifier);
  if (!ident) return undefined;

  const boundValue = extractLiteralValue(bindings?.get(ident.getText()), checker, bindings);
  return typeof boundValue === 'string' ? boundValue : undefined;
};

const getArrowFunctionForCall = (
  call: CallExpression,
  checker: TypeChecker
): ArrowFunction | undefined => {
  const ident = call.getExpression().asKind(SyntaxKind.Identifier);
  if (!ident) return undefined;

  const symbol = ident.getSymbol() ?? checker.getSymbolAtLocation(ident);
  const valueDecl = symbol?.getValueDeclaration();
  const arrow =
    valueDecl?.asKind(SyntaxKind.ArrowFunction) ??
    valueDecl
      ?.asKind(SyntaxKind.VariableDeclaration)
      ?.getInitializer()
      ?.asKind(SyntaxKind.ArrowFunction) ??
    ident
      .getSourceFile()
      .getVariableDeclaration(ident.getText())
      ?.getInitializer()
      ?.asKind(SyntaxKind.ArrowFunction);

  return arrow;
};

const resolveSettingValueObject = (
  init: Node,
  checker: TypeChecker
): { valueObj: ObjectLiteralExpression; bindings?: ParameterBindings } | undefined => {
  const directObject = unwrapNode(init).asKind(SyntaxKind.ObjectLiteralExpression);
  if (directObject) return { valueObj: directObject };

  const call = init.asKind(SyntaxKind.CallExpression);
  if (!call) return undefined;

  const arrow = getArrowFunctionForCall(call, checker);
  const bodyObject = arrow
    ? unwrapNode(arrow.getBody()).asKind(SyntaxKind.ObjectLiteralExpression)
    : undefined;
  if (arrow && bodyObject) {
    const args = call.getArguments();
    const bindings = new Map<string, Node>();
    for (const [index, parameter] of arrow.getParameters().entries()) {
      const arg = args[index];
      if (arg) bindings.set(parameter.getName(), arg);
    }
    return { valueObj: bodyObject, bindings };
  }

  const resolved = resolveCallExpressionReturn(call, checker);
  const resolvedObject = resolved
    ? unwrapNode(resolved).asKind(SyntaxKind.ObjectLiteralExpression)
    : undefined;
  return resolvedObject ? { valueObj: resolvedObject } : undefined;
};

const extractProperties = (
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
  return Array.from(properties).reduce(
    (acc, propAssignment) => {
      const key = propAssignment.getName();
      const init = propAssignment.getInitializer();
      if (!key || !init) return acc;

      const resolvedSetting = resolveSettingValueObject(init, checker);
      if (!resolvedSetting) return acc;

      const { valueObj, bindings } = resolvedSetting;
      if (
        !skipHiddenCheck &&
        valueObj
          .getProperty('hidden')
          ?.asKind(SyntaxKind.PropertyAssignment)
          ?.getInitializer()
          ?.getKind() === SyntaxKind.TrueKeyword
      ) {
        return acc;
      }
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

      const props = extractProperties(valueObj, checker, bindings);
      if (!skipHiddenCheck && props.hidden) return acc;
      if (isBareComponentSetting(valueObj)) return acc;

      const optionsResult = extractSelectOptions(valueObj, checker);
      const extractedOptions = optionsResult.ok ? optionsResult.value.values : undefined;
      const nonEmptyExtractedOptions =
        extractedOptions && extractedOptions.length > 0 ? extractedOptions : undefined;
      const extractedLabels = optionsResult.ok ? optionsResult.value.labels : undefined;

      const rawSetting = {
        type: props.typeNode,
        description: props.description,
        default: props.defaultLiteralValue,
        placeholder: props.placeholder,
        restartNeeded: props.restartNeeded,
        hidden: props.hidden,
        options: nonEmptyExtractedOptions ?? props.typeAssertionEnumValues,
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
        nonEmptyExtractedOptions ? extractedLabels : undefined,
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
