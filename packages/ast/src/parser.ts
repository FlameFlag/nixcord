import type { TypeChecker, Program, Node } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';

import { isObject, isPrimitive } from '@nixcord/shared';
import { OptionTypeMap } from '@nixcord/shared';
import {
  PARSE_INT_RADIX,
  NIX_ENUM_TYPE,
  NIX_TYPE_BOOL,
  NIX_TYPE_STR,
  NIX_TYPE_INT,
  NIX_TYPE_FLOAT,
  NIX_TYPE_ATTRS,
  NIX_TYPE_LIST_OF_STR,
  NIX_TYPE_LIST_OF_ATTRS,
  OPTION_TYPE_BOOLEAN,
  OPTION_TYPE_STRING,
  OPTION_TYPE_NUMBER,
  OPTION_TYPE_BIGINT,
  OPTION_TYPE_SELECT,
  OPTION_TYPE_SLIDER,
  OPTION_TYPE_COMPONENT,
  OPTION_TYPE_CUSTOM,
  TS_TYPE_STRING,
  TS_TYPE_NUMBER,
  TS_TYPE_BOOLEAN,
  TS_ARRAY_BRACKET_PATTERN,
  TS_ARRAY_GENERIC_PATTERN,
} from './extractor/constants.js';
import { isBooleanEnumValues } from './extractor/type-helpers.js';
import { evaluate, typeMatches } from './foundation/index.js';

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && typeof (value as Node).getKind === 'function';

const inferNixTypeFromRuntimeDefault = (defaultValue: unknown): string => {
  if (defaultValue === undefined) return NIX_TYPE_STR;
  if (typeof defaultValue === 'boolean') return NIX_TYPE_BOOL;
  if (Array.isArray(defaultValue)) return NIX_TYPE_ATTRS;
  if (typeof defaultValue === 'string') return NIX_TYPE_STR;
  if (typeof defaultValue === 'number')
    return Number.isInteger(defaultValue) ? NIX_TYPE_INT : NIX_TYPE_FLOAT;
  if (isObject(defaultValue)) return NIX_TYPE_ATTRS;
  return NIX_TYPE_STR;
};

const extractEnumValueFromDeclaration = (valueDeclaration: Node): number | undefined => {
  if (valueDeclaration.getKind() !== SyntaxKind.EnumMember) return undefined;
  try {
    const value = (valueDeclaration as { getValue?: () => number }).getValue?.();
    if (typeof value === 'number') return value;
  } catch {}
  const enumMember = valueDeclaration.asKind(SyntaxKind.EnumMember);
  const initializer = enumMember?.getInitializer();
  if (initializer?.getKind() === SyntaxKind.NumericLiteral) {
    return parseInt(
      initializer.asKindOrThrow(SyntaxKind.NumericLiteral).getLiteralValue().toString(),
      PARSE_INT_RADIX
    );
  }
  return undefined;
};

const resolveOptionTypeNameFromNode = (
  typeNode: Node,
  _checker: TypeChecker
): string | undefined => {
  const extractTypeValue = (): string | number | undefined => {
    switch (typeNode.getKind()) {
      case SyntaxKind.PropertyAccessExpression: {
        const propAccess = typeNode.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
        const propName = propAccess.getName();
        try {
          const symbol = propAccess.getSymbol();
          const valueDecl = symbol?.getValueDeclaration();
          if (valueDecl) {
            const enumValue = extractEnumValueFromDeclaration(valueDecl);
            return enumValue !== undefined
              ? ((OptionTypeMap[enumValue] as string | number) ?? propName)
              : propName;
          }
        } catch {}
        return propName;
      }
      case SyntaxKind.Identifier: {
        const symbol = typeNode.asKindOrThrow(SyntaxKind.Identifier).getSymbol();
        const valueDecl = symbol?.getValueDeclaration();
        if (!valueDecl) return undefined;
        const enumValue = extractEnumValueFromDeclaration(valueDecl);
        return enumValue !== undefined ? (OptionTypeMap[enumValue] as string | number) : undefined;
      }
      case SyntaxKind.NumericLiteral:
        return OptionTypeMap[
          parseInt(
            typeNode.asKindOrThrow(SyntaxKind.NumericLiteral).getLiteralValue().toString(),
            PARSE_INT_RADIX
          )
        ] as string | number;
      case SyntaxKind.BinaryExpression: {
        const result = evaluate(typeNode, _checker);
        if (result.ok && typeof result.value === 'number') {
          return OptionTypeMap[result.value] as string | number | undefined;
        }
        return undefined;
      }
      default:
        return undefined;
    }
  };

  const typeValue = extractTypeValue();
  if (typeValue === undefined) return undefined;

  if (typeof typeValue === 'string') return typeValue;
  if (typeof typeValue === 'number') return OptionTypeMap[typeValue] as string;
  return undefined;
};

const buildEnumValuesFromOptions = (
  options: unknown
): readonly (string | number | boolean)[] | undefined => {
  // Handle case where options are already extracted as EnumLiteral[] (string | number | boolean)
  if (Array.isArray(options)) {
    const validOptions = options.filter((opt): opt is string | number | boolean =>
      isPrimitive(opt)
    );
    if (validOptions.length > 0) return Object.freeze(validOptions);
  }

  // Handle case where options are in object format [{ value: 'x' }, { value: 'y' }]
  if (!Array.isArray(options)) return Object.freeze([]);

  return Object.freeze(
    (options as unknown[])
      .map((option) => {
        if (typeof option !== 'object' || option === null) return null;
        const val = (option as Record<string, unknown>).value;
        return isPrimitive(val) ? val : null;
      })
      .filter((val): val is string | number | boolean => val !== null)
  );
};

const nixTypeForComponentOrCustom = (defaultValue: unknown): string => {
  if (defaultValue === undefined) return NIX_TYPE_ATTRS;
  if (Array.isArray(defaultValue)) {
    if (defaultValue.length > 0 && defaultValue.every((v: unknown) => typeof v === 'string'))
      return NIX_TYPE_LIST_OF_STR;
    return NIX_TYPE_LIST_OF_ATTRS;
  }
  return inferNixTypeFromRuntimeDefault(defaultValue);
};

const inferTypeFromTypeScriptType = (
  typeNode: Node,
  checker: TypeChecker,
  defaultValue: unknown
): string | undefined => {
  try {
    const type = checker.getTypeAtLocation(typeNode);
    if (!type) return undefined;

    const typeName = type.getSymbol()?.getName() ?? type.getText();

    if (typeMatches(typeName, TS_TYPE_STRING)) return NIX_TYPE_STR;
    if (typeMatches(typeName, TS_TYPE_NUMBER))
      return typeof defaultValue === 'number'
        ? Number.isInteger(defaultValue)
          ? NIX_TYPE_INT
          : NIX_TYPE_FLOAT
        : NIX_TYPE_INT;
    if (typeMatches(typeName, TS_TYPE_BOOLEAN)) return NIX_TYPE_BOOL;
    if (typeName.includes(TS_ARRAY_BRACKET_PATTERN) || typeName.includes(TS_ARRAY_GENERIC_PATTERN))
      return NIX_TYPE_ATTRS;

    const unionTypes = type.getUnionTypes();
    if (unionTypes.length === 0) return undefined;

    const typeNames = unionTypes.map((t) => t.getText());
    const allStrings = typeNames.every((n) => typeMatches(n, TS_TYPE_STRING));
    const allNumbers = typeNames.every((n) => typeMatches(n, TS_TYPE_NUMBER));
    const allBooleans = typeNames.every((n) => typeMatches(n, TS_TYPE_BOOLEAN));

    if (allStrings) return NIX_TYPE_STR;
    if (allNumbers) return NIX_TYPE_INT;
    if (allBooleans) return NIX_TYPE_BOOL;
    return undefined;
  } catch {
    return undefined;
  }
};

export function tsTypeToNixType(
  setting: Readonly<{ type?: unknown; default?: unknown; options?: unknown }>,
  _program: Program,
  _checker: TypeChecker
): Readonly<{
  readonly nixType: string;
  readonly enumValues?: readonly (string | number | boolean)[];
}> {
  const type = setting.type;

  if (!type || !isNode(type)) {
    if (typeof type === 'number' && type in OptionTypeMap) {
      const typeValue = OptionTypeMap[type];
      if (typeValue === OPTION_TYPE_COMPONENT || typeValue === OPTION_TYPE_CUSTOM)
        return { nixType: nixTypeForComponentOrCustom(setting.default) };
    }
    const enumValues = buildEnumValuesFromOptions(setting.options);
    if (enumValues && enumValues.length > 0)
      return isBooleanEnumValues(enumValues)
        ? { nixType: NIX_TYPE_BOOL }
        : { nixType: NIX_ENUM_TYPE, enumValues };
    return { nixType: inferNixTypeFromRuntimeDefault(setting.default) };
  }

  const typeName = resolveOptionTypeNameFromNode(type, _checker);
  if (typeName !== undefined) {
    switch (typeName) {
      case OPTION_TYPE_BOOLEAN:
        return { nixType: NIX_TYPE_BOOL };
      case OPTION_TYPE_STRING:
        return { nixType: NIX_TYPE_STR };
      case OPTION_TYPE_NUMBER:
        return {
          nixType:
            typeof setting.default === 'number'
              ? Number.isInteger(setting.default)
                ? NIX_TYPE_INT
                : NIX_TYPE_FLOAT
              : NIX_TYPE_FLOAT,
        };
      case OPTION_TYPE_BIGINT:
        return { nixType: NIX_TYPE_INT };
      case OPTION_TYPE_SELECT: {
        const enumValues = buildEnumValuesFromOptions(setting.options) ?? Object.freeze([]);
        if (isBooleanEnumValues(enumValues)) return { nixType: NIX_TYPE_BOOL };
        if (enumValues.length === 0) return { nixType: NIX_TYPE_STR };
        return { nixType: NIX_ENUM_TYPE, enumValues };
      }
      case OPTION_TYPE_SLIDER:
        return { nixType: NIX_TYPE_FLOAT };
      case OPTION_TYPE_COMPONENT:
        return { nixType: nixTypeForComponentOrCustom(setting.default) };
      case OPTION_TYPE_CUSTOM:
        return { nixType: nixTypeForComponentOrCustom(setting.default) };
      default:
        return { nixType: inferNixTypeFromRuntimeDefault(setting.default) };
    }
  }

  const inferredType = inferTypeFromTypeScriptType(type, _checker, setting.default);
  const enumValues = buildEnumValuesFromOptions(setting.options);
  if (inferredType)
    return enumValues ? { nixType: inferredType, enumValues } : { nixType: inferredType };
  return enumValues
    ? { nixType: inferNixTypeFromRuntimeDefault(setting.default), enumValues }
    : { nixType: inferNixTypeFromRuntimeDefault(setting.default) };
}
