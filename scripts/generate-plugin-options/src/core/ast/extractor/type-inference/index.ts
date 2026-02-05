/**
 * Unified type inference - single-pass classifier.
 *
 * Replaces complex 4-pass pipeline with a single classification step.
 * Determines Nix type based on TypeScript annotations and default values.
 */

import type { TypeChecker, Program, ObjectLiteralExpression, Node } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { isEmpty } from 'remeda';
import { z } from 'zod';
import { tsTypeToNixType } from '../../parser.js';
import { extractSelectOptions } from '../select/index.js';
import {
  NIX_TYPE_BOOL,
  NIX_TYPE_STR,
  NIX_TYPE_ATTRS,
  NIX_TYPE_LIST_OF_STR,
  NIX_TYPE_LIST_OF_ATTRS,
  NIX_TYPE_NULL_OR_STR,
  OPTION_TYPE_COMPONENT,
  OPTION_TYPE_CUSTOM,
  BOOLEAN_ENUM_LENGTH,
} from '../constants.js';
import {
  hasStringArrayDefault,
  resolveIdentifierArrayDefault,
  hasObjectArrayDefault,
  hasEmptyArrayWithTypeAnnotation,
} from '../default-value-checks/index.js';
import { getDefaultPropertyInitializer, isCustomType } from '../type-helpers.js';
import type { SettingProperties as SP } from './types.js';

export type SettingProperties = SP;

export interface TypeInferenceResult {
  finalNixType: string;
  selectEnumValues: readonly (string | number | boolean)[] | undefined;
  defaultValue: unknown;
}

export function inferNixTypeAndEnumValues(
  valueObj: ObjectLiteralExpression,
  props: SettingProperties,
  rawSetting: {
    type: Node | undefined;
    description: string | undefined;
    default: unknown;
    placeholder?: string | undefined;
    restartNeeded: boolean;
    hidden: boolean;
    options?: readonly (string | number | boolean)[] | undefined;
  },
  checker: TypeChecker,
  program: Program,
  pluginName?: string,
  settingName?: string
): TypeInferenceResult {
  const { nixType: baseType, enumValues } = tsTypeToNixType(rawSetting, program, checker);

  const astEnumResult = extractSelectOptions(valueObj, checker);
  const astEnumLiterals = astEnumResult.isOk ? astEnumResult.value.values : [];
  const hasAstEnumValues = !isEmpty(astEnumLiterals);

  const selectEnumValues =
    enumValues && !isEmpty(enumValues)
      ? enumValues
      : hasAstEnumValues
        ? astEnumLiterals
        : undefined;

  const BooleanSchema = z.boolean();
  const isBooleanEnum =
    selectEnumValues !== undefined &&
    selectEnumValues.length === BOOLEAN_ENUM_LENGTH &&
    selectEnumValues.every((value) => BooleanSchema.safeParse(value).success) &&
    new Set(selectEnumValues).size === BOOLEAN_ENUM_LENGTH;

  if (isBooleanEnum) {
    return {
      finalNixType: NIX_TYPE_BOOL,
      selectEnumValues: undefined,
      defaultValue: props.defaultLiteralValue,
    };
  }

  if (selectEnumValues !== undefined) {
    return {
      finalNixType: 'types.enum',
      selectEnumValues,
      defaultValue: props.defaultLiteralValue,
    };
  }

  const classification = classifySetting(valueObj, props, baseType, checker);

  return {
    finalNixType: classification.nixType,
    selectEnumValues,
    defaultValue: classification.defaultValue ?? props.defaultLiteralValue,
  };
}

interface Classification {
  nixType: string;
  defaultValue: unknown;
}

function classifySetting(
  valueObj: ObjectLiteralExpression,
  props: SettingProperties,
  baseType: string,
  checker: TypeChecker
): Classification {
  const defaultValue = props.defaultLiteralValue;
  const isComponentOrCustom =
    props.typeNode?.isJust === true &&
    (props.typeNode.value.getText().includes(OPTION_TYPE_COMPONENT) ||
      props.typeNode.value.getText().includes(OPTION_TYPE_CUSTOM));

  const hasStringArray = hasStringArrayDefault(valueObj);
  const hasIdentifierStringArray =
    defaultValue === undefined && resolveIdentifierArrayDefault(valueObj);
  const hasObjectArray = hasObjectArrayDefault(valueObj, checker);
  const hasEmptyTypedArray = hasEmptyArrayWithTypeAnnotation(valueObj);

  if (hasStringArray || hasIdentifierStringArray) {
    return { nixType: NIX_TYPE_LIST_OF_STR, defaultValue: [] };
  }

  if (hasObjectArray) {
    const init = getDefaultPropertyInitializer(valueObj);
    const isIdentifierDefault = init?.getKind() === SyntaxKind.Identifier;

    if (!isIdentifierDefault) {
      return { nixType: NIX_TYPE_LIST_OF_ATTRS, defaultValue: [] };
    }
  }

  if (hasEmptyTypedArray) {
    const typeNodeText = props.typeNode?.isJust === true ? props.typeNode.value.getText() : '';
    return typeNodeText.includes(OPTION_TYPE_CUSTOM)
      ? { nixType: NIX_TYPE_LIST_OF_ATTRS, defaultValue: [] }
      : { nixType: NIX_TYPE_LIST_OF_STR, defaultValue: [] };
  }

  const init = getDefaultPropertyInitializer(valueObj);
  if (init && init.getKind() === SyntaxKind.ArrayLiteralExpression) {
    const arr = init.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
    if (arr.getElements().length === 0) {
      return { nixType: NIX_TYPE_LIST_OF_STR, defaultValue: [] };
    }
  }

  if (isComponentOrCustom) {
    return classifyComponentOrCustom(valueObj, props, baseType, defaultValue);
  }

  return { nixType: baseType, defaultValue };
}

function classifyComponentOrCustom(
  valueObj: ObjectLiteralExpression,
  props: SettingProperties,
  baseType: string,
  defaultValue: unknown
): Classification {
  const defPropNode = valueObj.getProperty('default');
  if (defPropNode?.getKind() === SyntaxKind.GetAccessor) {
    return { nixType: NIX_TYPE_NULL_OR_STR, defaultValue: null };
  }

  const init = getDefaultPropertyInitializer(valueObj);
  if (init?.getKind() === SyntaxKind.StringLiteral) {
    return { nixType: NIX_TYPE_STR, defaultValue };
  }

  if (typeof defaultValue === 'string') {
    return { nixType: NIX_TYPE_STR, defaultValue };
  }

  if (init?.getKind() === SyntaxKind.Identifier) {
    const minimalProps: SettingProperties = {
      typeNode: { isJust: false } as any,
      description: undefined,
      placeholder: undefined,
      restartNeeded: false,
      hidden: { isJust: false } as any,
      defaultLiteralValue: undefined,
    };

    if (isCustomType(valueObj, minimalProps)) {
      return { nixType: NIX_TYPE_ATTRS, defaultValue };
    }
  }

  if (
    baseType === NIX_TYPE_ATTRS ||
    baseType === NIX_TYPE_LIST_OF_ATTRS ||
    baseType === NIX_TYPE_LIST_OF_STR
  ) {
    return { nixType: baseType, defaultValue };
  }

  if (
    defaultValue === undefined ||
    (typeof defaultValue === 'object' && !Array.isArray(defaultValue))
  ) {
    return { nixType: NIX_TYPE_ATTRS, defaultValue };
  }

  return { nixType: baseType, defaultValue };
}
