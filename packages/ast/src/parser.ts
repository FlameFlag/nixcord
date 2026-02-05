import type { TypeChecker, Program, Node } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';

import { match, P } from 'ts-pattern';

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
import { evaluate } from './foundation.js';

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && typeof (value as Node).getKind === 'function';

const inferNixTypeFromRuntimeDefault = (defaultValue: unknown): string =>
  match(defaultValue)
    .with(undefined, () => NIX_TYPE_STR)
    .with(P.boolean, () => NIX_TYPE_BOOL)
    .when(Array.isArray, () => NIX_TYPE_ATTRS)
    .with(P.string, () => NIX_TYPE_STR)
    .with(P.number, (val) => (Number.isInteger(val) ? NIX_TYPE_INT : NIX_TYPE_FLOAT))
    .when(isObject, () => NIX_TYPE_ATTRS)
    .otherwise(() => NIX_TYPE_STR);

const extractEnumValueFromDeclaration = (valueDeclaration: Node): number | undefined =>
  match(valueDeclaration.getKind())
    .with(SyntaxKind.EnumMember, () => {
      try {
        const value = (valueDeclaration as { getValue?: () => number }).getValue?.();
        if (typeof value === 'number') return value;
      } catch {}
      const enumMember = valueDeclaration.asKind(SyntaxKind.EnumMember);
      const initializer = enumMember?.getInitializer();
      return match(initializer?.getKind())
        .with(SyntaxKind.NumericLiteral, () =>
          initializer
            ? parseInt(
                initializer.asKindOrThrow(SyntaxKind.NumericLiteral).getLiteralValue().toString(),
                PARSE_INT_RADIX
              )
            : undefined
        )
        .otherwise(() => undefined);
    })
    .otherwise(() => undefined);

const resolveOptionTypeNameFromNode = (
  typeNode: Node,
  _checker: TypeChecker
): string | undefined => {
  const extractTypeValue = (): string | number | undefined =>
    match(typeNode.getKind())
      .with(SyntaxKind.PropertyAccessExpression, () => {
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
      })
      .with(SyntaxKind.Identifier, () => {
        const symbol = typeNode.asKindOrThrow(SyntaxKind.Identifier).getSymbol();
        const valueDecl = symbol?.getValueDeclaration();
        if (!valueDecl) return undefined;
        const enumValue = extractEnumValueFromDeclaration(valueDecl);
        return enumValue !== undefined ? (OptionTypeMap[enumValue] as string | number) : undefined;
      })
      .with(
        SyntaxKind.NumericLiteral,
        () =>
          OptionTypeMap[
            parseInt(
              typeNode.asKindOrThrow(SyntaxKind.NumericLiteral).getLiteralValue().toString(),
              PARSE_INT_RADIX
            )
          ] as string | number
      )
      .with(SyntaxKind.BinaryExpression, () => {
        const result = evaluate(typeNode, _checker);
        if (result.ok && typeof result.value === 'number') {
          return OptionTypeMap[result.value] as string | number | undefined;
        }
        return undefined;
      })
      .otherwise(() => undefined);

  const typeValue = extractTypeValue();
  if (typeValue === undefined) return undefined;

  return match(typeValue)
    .with(P.string, (v) => v)
    .with(P.number, (v) => OptionTypeMap[v] as string)
    .otherwise(() => undefined);
};

const buildEnumValuesFromOptions = (
  options: unknown
): readonly (string | number | boolean)[] | undefined => {
  // Handle case where options are already extracted as EnumLiteral[] (string | number | boolean)
  if (Array.isArray(options)) {
    const validOptions = options.filter(
      (opt): opt is string | number | boolean => isPrimitive(opt)
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

const nixTypeForComponentOrCustom = (defaultValue: unknown): string =>
  match(defaultValue)
    .with(undefined, () => NIX_TYPE_ATTRS)
    .when(Array.isArray, (arr) => {
      if (arr.length > 0 && arr.every((v: unknown) => typeof v === 'string')) return NIX_TYPE_LIST_OF_STR;
      return NIX_TYPE_ATTRS;
    })
    .otherwise(() => inferNixTypeFromRuntimeDefault(defaultValue));

const inferTypeFromTypeScriptType = (
  typeNode: Node,
  checker: TypeChecker,
  defaultValue: unknown
): string | undefined => {
  try {
    const type = checker.getTypeAtLocation(typeNode);
    if (!type) return undefined;

    const typeName = type.getSymbol()?.getName() ?? type.getText();

    const checkString = () => typeName === TS_TYPE_STRING || typeName.includes(TS_TYPE_STRING);
    const checkNumber = () => typeName === TS_TYPE_NUMBER || typeName.includes(TS_TYPE_NUMBER);
    const checkBoolean = () => typeName === TS_TYPE_BOOLEAN || typeName.includes(TS_TYPE_BOOLEAN);
    const checkArray = () =>
      typeName.includes(TS_ARRAY_BRACKET_PATTERN) || typeName.includes(TS_ARRAY_GENERIC_PATTERN);

    if (checkString()) return NIX_TYPE_STR;
    if (checkNumber())
      return match(defaultValue)
        .with(P.number, (val) => (Number.isInteger(val) ? NIX_TYPE_INT : NIX_TYPE_FLOAT))
        .otherwise(() => NIX_TYPE_INT);
    if (checkBoolean()) return NIX_TYPE_BOOL;
    if (checkArray()) return NIX_TYPE_ATTRS;

    const unionTypes = type.getUnionTypes();
    if (unionTypes.length === 0) return undefined;

    const typeNames = unionTypes.map((t) => t.getText());
    const allStrings = typeNames.every((n) => n === TS_TYPE_STRING || n.includes(TS_TYPE_STRING));
    const allNumbers = typeNames.every((n) => n === TS_TYPE_NUMBER || n.includes(TS_TYPE_NUMBER));
    const allBooleans = typeNames.every(
      (n) => n === TS_TYPE_BOOLEAN || n.includes(TS_TYPE_BOOLEAN)
    );

    return match([allStrings, allNumbers, allBooleans] as const)
      .with([true, P._, P._], () => NIX_TYPE_STR)
      .with([P._, true, P._], () => NIX_TYPE_INT)
      .with([P._, P._, true], () => NIX_TYPE_BOOL)
      .otherwise(() => undefined as string | undefined);
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
    return match(typeName)
      .with(OPTION_TYPE_BOOLEAN, () => ({ nixType: NIX_TYPE_BOOL }))
      .with(OPTION_TYPE_STRING, () => ({ nixType: NIX_TYPE_STR }))
      .with(OPTION_TYPE_NUMBER, () => ({
        nixType: match(setting.default)
          .with(P.number, (val) => (Number.isInteger(val) ? NIX_TYPE_INT : NIX_TYPE_FLOAT))
          .otherwise(() => NIX_TYPE_FLOAT),
      }))
      .with(OPTION_TYPE_BIGINT, () => ({ nixType: NIX_TYPE_INT }))
      .with(OPTION_TYPE_SELECT, () => {
        const enumValues = buildEnumValuesFromOptions(setting.options) ?? Object.freeze([]);
        if (isBooleanEnumValues(enumValues)) return { nixType: NIX_TYPE_BOOL };
        if (enumValues.length === 0) return { nixType: NIX_TYPE_STR };
        return { nixType: NIX_ENUM_TYPE, enumValues };
      })
      .with(OPTION_TYPE_SLIDER, () => ({ nixType: NIX_TYPE_FLOAT }))
      .with(OPTION_TYPE_COMPONENT, () => ({
        nixType: nixTypeForComponentOrCustom(setting.default),
      }))
      .with(OPTION_TYPE_CUSTOM, () => ({ nixType: nixTypeForComponentOrCustom(setting.default) }))
      .otherwise(() => ({ nixType: inferNixTypeFromRuntimeDefault(setting.default) }));
  }

  const inferredType = inferTypeFromTypeScriptType(type, _checker, setting.default);
  const enumValues = buildEnumValuesFromOptions(setting.options);
  if (inferredType)
    return enumValues ? { nixType: inferredType, enumValues } : { nixType: inferredType };
  return enumValues
    ? { nixType: inferNixTypeFromRuntimeDefault(setting.default), enumValues }
    : { nixType: inferNixTypeFromRuntimeDefault(setting.default) };
}
