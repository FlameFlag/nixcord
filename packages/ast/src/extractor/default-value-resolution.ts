import type { TypeChecker, ObjectLiteralExpression } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';

import {
  DEFAULT_PROPERTY,
  NIX_ENUM_TYPE,
  NIX_TYPE_BOOL,
  NIX_TYPE_STR,
  NIX_TYPE_ATTRS,
  NIX_TYPE_LIST_OF_ATTRS,
  NIX_TYPE_NULL_OR_STR,
  NIX_TYPE_LIST_OF_STR,
  COMPONENT_PROPERTY,
} from './constants.js';
import { getDefaultPropertyInitializer, isCustomType } from './type-helpers.js';
import { extractSelectDefault } from './select/index.js';
import { extractDefaultValue } from './default-value.js';
import {
  hasObjectArrayDefault,
  hasStringArrayDefault,
  resolveIdentifierArrayDefault,
} from './default-value-checks/index.js';
import { createMinimalProps } from './type-inference/types.js';

const BARE_COMPONENT_ALLOWED_PROPS = new Set([
  'type',
  'component',
  'description',
  'name',
  'restartNeeded',
  'hidden',
  'placeholder',
]);

export const isBareComponentSetting = (obj: ObjectLiteralExpression): boolean => {
  const hasDisallowed = obj.getProperties().some((p) => {
    const nameNode =
      p.asKind(SyntaxKind.PropertyAssignment)?.getNameNode() ??
      p.asKind(SyntaxKind.MethodDeclaration)?.getNameNode();
    if (!nameNode) return false;
    const key =
      nameNode.asKind(SyntaxKind.Identifier)?.getText().replace(/['"]/g, '') ??
      nameNode.asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
    return !!key && !BARE_COMPONENT_ALLOWED_PROPS.has(key);
  });
  return (
    !hasDisallowed && !obj.getProperty(DEFAULT_PROPERTY) && !!obj.getProperty(COMPONENT_PROPERTY)
  );
};

const classifyAsAttrsType = (
  valueObj: ObjectLiteralExpression,
  checker: TypeChecker
): { isAttrs: boolean; defaultValue: unknown[] | Record<string, never> } | undefined => {
  const init = getDefaultPropertyInitializer(valueObj);
  const initIdent = init?.asKind(SyntaxKind.Identifier);
  const customType = isCustomType(valueObj, createMinimalProps());
  const hasObjArray = hasObjectArrayDefault(valueObj, checker);
  if (initIdent && (customType || hasObjArray)) {
    return { isAttrs: true, defaultValue: hasObjArray ? [] : {} };
  }
  return undefined;
};

const resolveAttrsDefault = (valueObj: ObjectLiteralExpression, checker: TypeChecker): unknown => {
  const defPropNode = valueObj.getProperty(DEFAULT_PROPERTY);
  const propKind = defPropNode?.getKind();
  const init = defPropNode?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();

  if (propKind === SyntaxKind.PropertyAssignment && init?.getKind() === SyntaxKind.Identifier) {
    return hasObjectArrayDefault(valueObj, checker) ? [] : {};
  }
  if (propKind === SyntaxKind.PropertyAssignment && init?.getKind() === SyntaxKind.CallExpression) {
    const result = extractDefaultValue(valueObj, checker);
    return result.ok ? result.value : {};
  }
  if (propKind === SyntaxKind.GetAccessor) {
    return null;
  }
  return {};
};

export interface ResolvedDefaultValue {
  finalNixType: string;
  defaultValue: unknown;
}

export function resolveDefaultValue(
  valueObj: ObjectLiteralExpression,
  finalNixType: string,
  defaultLiteralValue: unknown,
  selectEnumValues: readonly (string | number | boolean)[] | undefined,
  checker: TypeChecker
): ResolvedDefaultValue {
  let defaultValue = defaultLiteralValue;
  let finalNixTypeWithNull = finalNixType;

  if (
    defaultLiteralValue === undefined &&
    (resolveIdentifierArrayDefault(valueObj) || hasStringArrayDefault(valueObj))
  ) {
    return { finalNixType: NIX_TYPE_LIST_OF_STR, defaultValue: [] };
  }

  if (finalNixType === NIX_TYPE_BOOL && defaultLiteralValue === undefined) {
    const result = extractSelectDefault(valueObj, checker);
    defaultValue = result.ok && result.value !== undefined ? result.value : false;
  }

  if (finalNixType === NIX_ENUM_TYPE && defaultLiteralValue === undefined) {
    const result = extractSelectDefault(valueObj, checker);
    defaultValue =
      result.ok && result.value !== undefined
        ? result.value
        : selectEnumValues && selectEnumValues.length > 0
          ? selectEnumValues[0]
          : undefined;
  }

  if (finalNixType === NIX_TYPE_STR && defaultValue === undefined) {
    const attrsResult = classifyAsAttrsType(valueObj, checker);
    if (attrsResult) {
      finalNixTypeWithNull = NIX_TYPE_ATTRS;
      defaultValue = attrsResult.defaultValue;
    } else {
      finalNixTypeWithNull = NIX_TYPE_NULL_OR_STR;
      defaultValue = null;
    }
  }

  const isNullOrType = finalNixType.includes('nullOr') || finalNixTypeWithNull.includes('nullOr');
  if (isNullOrType && defaultLiteralValue === undefined) {
    defaultValue = null;
    if (finalNixType.includes('nullOr') && !finalNixTypeWithNull.includes('nullOr')) {
      finalNixTypeWithNull = finalNixType;
    }
  }

  if (finalNixType === NIX_TYPE_ATTRS && defaultValue === undefined) {
    defaultValue = resolveAttrsDefault(valueObj, checker);
    if (defaultValue === undefined) {
      defaultValue = isBareComponentSetting(valueObj) ? {} : resolveAttrsDefault(valueObj, checker);
    }
  }

  if (finalNixType === NIX_TYPE_NULL_OR_STR && defaultValue === null) {
    const attrsResult = classifyAsAttrsType(valueObj, checker);
    if (attrsResult) {
      finalNixTypeWithNull = NIX_TYPE_ATTRS;
      defaultValue = attrsResult.defaultValue;
    }
  }

  if (finalNixTypeWithNull === NIX_TYPE_ATTRS && Array.isArray(defaultValue)) {
    finalNixTypeWithNull = NIX_TYPE_LIST_OF_ATTRS;
  }

  if (finalNixTypeWithNull === NIX_TYPE_ATTRS && defaultValue === null) {
    finalNixTypeWithNull = `types.nullOr ${NIX_TYPE_ATTRS}`;
  }

  return { finalNixType: finalNixTypeWithNull, defaultValue };
}
