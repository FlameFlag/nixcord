import type { TypeChecker, ObjectLiteralExpression } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { isEmpty } from 'remeda';
import { match, P } from 'ts-pattern';
import {
  DEFAULT_PROPERTY,
  NIX_ENUM_TYPE,
  NIX_TYPE_BOOL,
  NIX_TYPE_STR,
  NIX_TYPE_ATTRS,
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

const BARE_COMPONENT_ALLOWED_PROPS = new Set([
  'type',
  'component',
  'description',
  'name',
  'restartNeeded',
  'hidden',
  'placeholder',
]);

const isBareComponentSetting = (obj: ObjectLiteralExpression): boolean => {
  const hasOnlyAllowed = obj.getProperties().every((p) => {
    const propAssign = p.asKind(SyntaxKind.PropertyAssignment);
    const methodDecl = p.asKind(SyntaxKind.MethodDeclaration);
    const nameNode = propAssign?.getNameNode() ?? methodDecl?.getNameNode();
    if (!nameNode) return true;
    const ident = nameNode.asKind(SyntaxKind.Identifier);
    const str = ident ? undefined : nameNode.asKind(SyntaxKind.StringLiteral);
    const key = ident?.getText().replace(/['"]/g, '') ?? str?.getLiteralValue();
    return !key || BARE_COMPONENT_ALLOWED_PROPS.has(key);
  });
  return (
    hasOnlyAllowed && !obj.getProperty(DEFAULT_PROPERTY) && !!obj.getProperty(COMPONENT_PROPERTY)
  );
};

const createMinimalProps = () => ({
  typeNode: { isJust: false } as any,
  description: undefined,
  placeholder: undefined,
  restartNeeded: false,
  hidden: { isJust: false } as any,
  defaultLiteralValue: undefined,
});

const resolveAttrsDefault = (valueObj: ObjectLiteralExpression, checker: TypeChecker): unknown => {
  const defPropNode = valueObj.getProperty(DEFAULT_PROPERTY);
  const propKind = defPropNode?.getKind();
  const init = defPropNode?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();

  return match([propKind, init?.getKind()] as const)
    .with([SyntaxKind.PropertyAssignment, SyntaxKind.Identifier], () =>
      hasObjectArrayDefault(valueObj, checker) ? [] : {}
    )
    .with([SyntaxKind.PropertyAssignment, SyntaxKind.CallExpression], () => {
      const result = extractDefaultValue(valueObj, checker);
      return result.isOk ? result.value : {};
    })
    .with([SyntaxKind.GetAccessor, P._], () => null)
    .with([undefined, undefined], () => ({}))
    .otherwise(() => ({}));
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
    defaultValue = result.isOk && result.value !== undefined ? result.value : false;
  }

  if (finalNixType === NIX_ENUM_TYPE && defaultLiteralValue === undefined) {
    const result = extractSelectDefault(valueObj, checker);
    defaultValue =
      result.isOk && result.value !== undefined
        ? result.value
        : selectEnumValues && !isEmpty(selectEnumValues)
          ? selectEnumValues[0]
          : undefined;
  }

  if (finalNixType === NIX_TYPE_STR && defaultValue === undefined) {
    const init = getDefaultPropertyInitializer(valueObj);
    const initIdent = init?.asKind(SyntaxKind.Identifier);
    const customType = isCustomType(valueObj, createMinimalProps());
    const hasObjArray = hasObjectArrayDefault(valueObj, checker);
    if (initIdent && (customType || hasObjArray)) {
      finalNixTypeWithNull = NIX_TYPE_ATTRS;
      defaultValue = hasObjArray ? [] : {};
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
  }

  if (finalNixType === NIX_TYPE_ATTRS && defaultValue === undefined) {
    defaultValue = isBareComponentSetting(valueObj) ? {} : resolveAttrsDefault(valueObj, checker);
  }

  if (finalNixType === NIX_TYPE_NULL_OR_STR && defaultValue === null) {
    const init = getDefaultPropertyInitializer(valueObj);
    const initIdent = init?.asKind(SyntaxKind.Identifier);
    const customType = isCustomType(valueObj, createMinimalProps());
    const hasObjArray = hasObjectArrayDefault(valueObj, checker);
    if (initIdent && (customType || hasObjArray)) {
      finalNixTypeWithNull = NIX_TYPE_ATTRS;
      defaultValue = hasObjArray ? [] : {};
    }
  }

  return { finalNixType: finalNixTypeWithNull, defaultValue };
}
