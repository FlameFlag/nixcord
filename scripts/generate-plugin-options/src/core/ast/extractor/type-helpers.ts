import type { ObjectLiteralExpression, Node } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import {
  TYPE_PROPERTY,
  DEFAULT_PROPERTY,
  OPTION_TYPE_CUSTOM,
  BOOLEAN_ENUM_LENGTH,
} from './constants.js';
import type { SettingProperties } from './type-inference/index.js';
import { getPropertyInitializer } from '../utils/node-helpers.js';
import type { EnumLiteral } from './constants.js';

const checkPropertyAccessCustom = (node: Node): boolean =>
  node.getKind() === SyntaxKind.PropertyAccessExpression &&
  node.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getNameNode().getKind() ===
    SyntaxKind.Identifier &&
  node.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getNameNode().getText() ===
    OPTION_TYPE_CUSTOM;

const isCustomTypeInNode = (node: Node): boolean =>
  checkPropertyAccessCustom(node) || node.getText().includes(OPTION_TYPE_CUSTOM);

export function getDefaultPropertyInitializer(obj: ObjectLiteralExpression): Node | undefined {
  return getPropertyInitializer(obj, DEFAULT_PROPERTY).unwrapOr(undefined);
}

export function isCustomType(valueObj: ObjectLiteralExpression, props: SettingProperties): boolean {
  const typeProp = valueObj.getProperty(TYPE_PROPERTY);
  if (typeProp?.getKind() === SyntaxKind.PropertyAssignment) {
    const typeInit = typeProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
    if (typeInit && isCustomTypeInNode(typeInit)) return true;
  }

  if (props.typeNode?.isJust) {
    return isCustomTypeInNode(props.typeNode.value);
  }
  return false;
}

export function isBooleanEnumValues(values: readonly EnumLiteral[]): boolean {
  if (values.length !== BOOLEAN_ENUM_LENGTH) return false;
  if (new Set(values).size !== BOOLEAN_ENUM_LENGTH) return false;
  return values.every((v) => typeof v === 'boolean');
}
