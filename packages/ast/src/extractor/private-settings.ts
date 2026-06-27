import type { PluginConfig, PluginSetting } from '@nixcord/shared';
import type { CallExpression, Node, Program, TypeChecker, TypeLiteralNode } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import type { EnumLiteral } from '../foundation/index.js';
import { isBooleanEnumValues, tryEvaluate } from '../foundation/index.js';
import { tsTypeToNixType } from '../parser.js';
import {
  NIX_ENUM_TYPE,
  NIX_TYPE_ATTRS,
  NIX_TYPE_BOOL,
  NIX_TYPE_FLOAT,
  NIX_TYPE_INT,
  NIX_TYPE_LIST_OF_STR,
  NIX_TYPE_NULL_OR_STR,
  NIX_TYPE_STR,
} from './constants.js';
import { extractLiteralUnionFromTypes } from './literal-value.js';
import { buildPluginSetting } from './setting-shape.js';

const WITH_PRIVATE_SETTINGS_METHOD_NAME = 'withPrivateSettings';
const EXTERNAL_ENUM_VALUES: Readonly<Record<string, readonly EnumLiteral[]>> = {
  ActivityType: Object.freeze([0, 1, 2, 3, 4, 5, 6]),
  ChannelType: Object.freeze([0, 1, 2]),
  StatusType: Object.freeze([0, 1, 2, 3]),
};

const getChainedCall = (
  callExpr: CallExpression,
  methodName: string
): CallExpression | undefined => {
  const parent = callExpr.getParent();
  const propAccess = parent?.asKind(SyntaxKind.PropertyAccessExpression);
  if (!propAccess || propAccess.getName() !== methodName) return undefined;

  const outerCall = propAccess.getParent()?.asKind(SyntaxKind.CallExpression);
  return outerCall?.getExpression() === propAccess ? outerCall : undefined;
};

const getPropertySignatureName = (node: Node): string | undefined => {
  const nameNode = node.asKind(SyntaxKind.PropertySignature)?.getNameNode();
  if (!nameNode) return undefined;

  const identifier = nameNode.asKind(SyntaxKind.Identifier);
  if (identifier) return identifier.getText();

  const stringLiteral = nameNode.asKind(SyntaxKind.StringLiteral);
  if (stringLiteral) return stringLiteral.getLiteralValue();

  const numericLiteral = nameNode.asKind(SyntaxKind.NumericLiteral);
  if (numericLiteral) return numericLiteral.getLiteralValue().toString();

  return undefined;
};

const extractEnumValuesFromDeclaration = (
  declaration: Node,
  checker: TypeChecker
): readonly EnumLiteral[] | undefined => {
  const enumDecl = declaration.asKind(SyntaxKind.EnumDeclaration);
  if (!enumDecl) return undefined;

  const values = enumDecl.getMembers().map((member): EnumLiteral | undefined => {
    try {
      const value = member.getValue();
      if (['string', 'number', 'boolean'].includes(typeof value)) return value as EnumLiteral;
    } catch {}

    const init = member.getInitializer();
    if (!init) return undefined;
    const result = tryEvaluate(init, checker);
    return ['string', 'number', 'boolean'].includes(typeof result)
      ? (result as EnumLiteral)
      : undefined;
  });

  return values.every((value): value is EnumLiteral => value !== undefined)
    ? Object.freeze(values)
    : undefined;
};

const extractEnumValuesFromTypeNode = (
  typeNode: Node,
  checker: TypeChecker
): readonly EnumLiteral[] | undefined => {
  const externalValues = EXTERNAL_ENUM_VALUES[typeNode.getText()];
  if (externalValues) return externalValues;

  try {
    const type = checker.getTypeAtLocation(typeNode);
    const unionValues = extractLiteralUnionFromTypes(type.getUnionTypes(), typeNode);
    if (unionValues) return unionValues;
  } catch {}

  const typeName =
    typeNode.asKind(SyntaxKind.TypeReference)?.getTypeName() ??
    typeNode.asKind(SyntaxKind.ExpressionWithTypeArguments)?.getExpression();
  const symbol = typeName?.getSymbol();
  const aliasedSymbol = symbol?.getAliasedSymbol();
  const declarations = aliasedSymbol?.getDeclarations() ?? symbol?.getDeclarations() ?? [];

  for (const declaration of declarations) {
    const enumValues = extractEnumValuesFromDeclaration(declaration, checker);
    if (enumValues) return enumValues;
  }

  return undefined;
};

const typeTextIncludesArrayOfString = (typeText: string): boolean =>
  typeText === 'string[]' || /^Array\s*<\s*string\s*>$/.test(typeText);

const typeTextIncludesRecord = (typeText: string): boolean =>
  /^Record\s*<.+>$/.test(typeText) || typeText.includes('{ [');

const inferPrivateSettingType = (
  typeNode: Node | undefined,
  checker: TypeChecker,
  program: Program
): { type: string; defaultValue: unknown; enumValues?: readonly EnumLiteral[] } => {
  if (!typeNode) return { type: NIX_TYPE_ATTRS, defaultValue: {} };

  const typeText = typeNode.getText().replace(/\s+/g, ' ');
  if (typeTextIncludesArrayOfString(typeText)) {
    return { type: NIX_TYPE_LIST_OF_STR, defaultValue: [] };
  }
  if (typeTextIncludesRecord(typeText)) {
    return { type: NIX_TYPE_ATTRS, defaultValue: {} };
  }

  const enumValues = extractEnumValuesFromTypeNode(typeNode, checker);
  if (enumValues && enumValues.length > 0) {
    if (isBooleanEnumValues(enumValues)) {
      return { type: NIX_TYPE_BOOL, defaultValue: false };
    }
    return { type: NIX_ENUM_TYPE, defaultValue: enumValues[0], enumValues };
  }

  const typeResult = tsTypeToNixType({ type: typeNode }, program, checker);
  switch (typeResult.nixType) {
    case NIX_TYPE_BOOL:
      return { type: NIX_TYPE_BOOL, defaultValue: false };
    case NIX_TYPE_INT:
      return { type: NIX_TYPE_INT, defaultValue: 0 };
    case NIX_TYPE_FLOAT:
      return { type: NIX_TYPE_FLOAT, defaultValue: 0 };
    case NIX_TYPE_STR:
    case NIX_TYPE_NULL_OR_STR:
      return { type: NIX_TYPE_NULL_OR_STR, defaultValue: null };
    default:
      return { type: NIX_TYPE_ATTRS, defaultValue: {} };
  }
};

const extractPrivateSettingsFromTypeLiteral = (
  typeLiteral: TypeLiteralNode,
  checker: TypeChecker,
  program: Program
): Record<string, PluginSetting | PluginConfig> => {
  const result: Record<string, PluginSetting | PluginConfig> = {};

  for (const member of typeLiteral.getMembers()) {
    const property = member.asKind(SyntaxKind.PropertySignature);
    if (!property) continue;

    const key = getPropertySignatureName(property);
    if (!key) continue;

    const propertyTypeNode = property.getTypeNode();
    const nestedTypeLiteral = propertyTypeNode?.asKind(SyntaxKind.TypeLiteral);
    if (nestedTypeLiteral) {
      result[key] = {
        name: key,
        settings: extractPrivateSettingsFromTypeLiteral(
          nestedTypeLiteral,
          checker,
          program
        ) as Record<string, PluginSetting>,
      };
      continue;
    }

    const inferred = inferPrivateSettingType(propertyTypeNode, checker, program);
    result[key] = buildPluginSetting(
      key,
      inferred.type,
      undefined,
      inferred.defaultValue,
      inferred.enumValues,
      undefined,
      undefined,
      false,
      false
    );
  }

  return result;
};

export const extractPrivateSettingsFromChainedCall = (
  callExpr: CallExpression,
  checker: TypeChecker,
  program: Program
): Record<string, PluginSetting | PluginConfig> => {
  const privateSettingsCall = getChainedCall(callExpr, WITH_PRIVATE_SETTINGS_METHOD_NAME);
  const typeArg = privateSettingsCall?.getTypeArguments()[0]?.asKind(SyntaxKind.TypeLiteral);
  return typeArg ? extractPrivateSettingsFromTypeLiteral(typeArg, checker, program) : {};
};
