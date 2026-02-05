import type { TypeChecker, Program, Node } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { pipe, map, filter, isEmpty } from 'remeda';
import { match, P } from 'ts-pattern';
import { z } from 'zod';
import { Maybe } from 'true-myth';
import { isObject } from '../../shared/type-guards.js';
import { OptionTypeMap } from '../../shared/types.js';
import {
  PARSE_INT_RADIX,
  NIX_ENUM_TYPE,
  NIX_TYPE_BOOL,
  NIX_TYPE_STR,
  NIX_TYPE_INT,
  NIX_TYPE_FLOAT,
  NIX_TYPE_ATTRS,
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

const EnumValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const OptionsArraySchema = z
  .array(z.object({ value: EnumValueSchema.optional() }).catchall(z.unknown()))
  .nullable()
  .optional();

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

const extractEnumValueFromDeclaration = (valueDeclaration: Node): Maybe<number> =>
  match(valueDeclaration.getKind())
    .with(SyntaxKind.EnumMember, () => {
      try {
        const value = (valueDeclaration as { getValue?: () => number }).getValue?.();
        if (z.number().safeParse(value).success) return Maybe.just(value as number);
      } catch {}
      const enumMember = valueDeclaration.asKind(SyntaxKind.EnumMember);
      const initializer = enumMember?.getInitializer();
      return match(initializer?.getKind())
        .with(SyntaxKind.NumericLiteral, () =>
          initializer
            ? Maybe.just(
                parseInt(
                  initializer.asKindOrThrow(SyntaxKind.NumericLiteral).getLiteralValue().toString(),
                  PARSE_INT_RADIX
                )
              )
            : Maybe.nothing<number>()
        )
        .otherwise(() => Maybe.nothing<number>());
    })
    .otherwise(() => Maybe.nothing<number>());

const resolveOptionTypeNameFromNode = (typeNode: Node, _checker: TypeChecker): Maybe<string> => {
  const extractTypeValue = (): Maybe<string | number> =>
    match(typeNode.getKind())
      .with(SyntaxKind.PropertyAccessExpression, () => {
        const propAccess = typeNode.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
        const propName = propAccess.getName();
        try {
          const symbol = propAccess.getSymbol();
          const valueDecl = symbol?.getValueDeclaration();
          if (valueDecl) {
            const enumValue = extractEnumValueFromDeclaration(valueDecl);
            return enumValue
              .map((val) => OptionTypeMap[val] as string | number)
              .orElse(() => Maybe.just<string | number>(propName));
          }
        } catch {}
        return Maybe.just<string | number>(propName);
      })
      .with(SyntaxKind.Identifier, () => {
        const symbol = typeNode.asKindOrThrow(SyntaxKind.Identifier).getSymbol();
        const valueDecl = symbol?.getValueDeclaration();
        return valueDecl
          ? extractEnumValueFromDeclaration(valueDecl).map(
              (val) => OptionTypeMap[val] as string | number
            )
          : Maybe.nothing<string | number>();
      })
      .with(SyntaxKind.NumericLiteral, () =>
        Maybe.just<string | number>(
          OptionTypeMap[
            parseInt(
              typeNode.asKindOrThrow(SyntaxKind.NumericLiteral).getLiteralValue().toString(),
              PARSE_INT_RADIX
            )
          ] as string | number
        )
      )
      .otherwise(() => Maybe.nothing<string | number>());

  const typeValueResult = extractTypeValue();
  if (typeValueResult.isNothing) return Maybe.nothing<string>();

  const resolved = match(typeValueResult.value)
    .with(P.string, (v) => v)
    .with(P.number, (v) => OptionTypeMap[v] as string)
    .otherwise(() => undefined as string | undefined);

  return resolved !== undefined ? Maybe.just(resolved) : Maybe.nothing<string>();
};

const buildEnumValuesFromOptions = (
  options: unknown
): readonly (string | number | boolean)[] | undefined => {
  // Handle case where options are already extracted as EnumLiteral[] (string | number | boolean)
  if (Array.isArray(options)) {
    const validOptions = options.filter(
      (opt): opt is string | number | boolean =>
        typeof opt === 'string' || typeof opt === 'number' || typeof opt === 'boolean'
    );
    if (validOptions.length > 0) return Object.freeze(validOptions);
  }

  // Handle case where options are in object format [{ value: 'x' }, { value: 'y' }]
  const parseResult = OptionsArraySchema.safeParse(options);
  if (!parseResult.success || !parseResult.data) return Object.freeze([]);

  return Object.freeze(
    pipe(
      parseResult.data,
      map((option) =>
        EnumValueSchema.safeParse(option.value).success
          ? (option.value as string | number | boolean)
          : null
      ),
      filter((val): val is string | number | boolean => val !== null)
    )
  );
};

const nixTypeForComponentOrCustom = (defaultValue: unknown): string =>
  match(defaultValue)
    .with(undefined, () => NIX_TYPE_ATTRS)
    .when(Array.isArray, () => NIX_TYPE_STR)
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

    const typeNames = pipe(
      unionTypes,
      map((t) => t.getText())
    );
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
    const parsedType = z.number().safeParse(type);
    if (parsedType.success && parsedType.data in OptionTypeMap) {
      const typeValue = OptionTypeMap[parsedType.data];
      if (typeValue === OPTION_TYPE_COMPONENT || typeValue === OPTION_TYPE_CUSTOM)
        return { nixType: nixTypeForComponentOrCustom(setting.default) };
    }
    const enumValues = buildEnumValuesFromOptions(setting.options);
    if (enumValues && !isEmpty(enumValues))
      return isBooleanEnumValues(enumValues)
        ? { nixType: NIX_TYPE_BOOL }
        : { nixType: NIX_ENUM_TYPE, enumValues };
    return { nixType: inferNixTypeFromRuntimeDefault(setting.default) };
  }

  const typeName = resolveOptionTypeNameFromNode(type, _checker);
  if (typeName.isJust) {
    return match(typeName.value)
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
