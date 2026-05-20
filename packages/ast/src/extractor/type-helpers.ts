import type { Node, ObjectLiteralExpression } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { OPTION_TYPE_CUSTOM, TYPE_PROPERTY } from './constants.js';
import type { SettingProperties } from './type-inference/types.js';

export { getDefaultPropertyInitializer, isBooleanEnumValues } from '../foundation/index.js';

const checkPropertyAccessCustom = (node: Node): boolean =>
  node.getKind() === SyntaxKind.PropertyAccessExpression &&
  node.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getNameNode().getKind() ===
    SyntaxKind.Identifier &&
  node.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getNameNode().getText() ===
    OPTION_TYPE_CUSTOM;

const isCustomTypeInNode = (node: Node): boolean =>
  checkPropertyAccessCustom(node) || node.getText().includes(OPTION_TYPE_CUSTOM);

export function isCustomType(valueObj: ObjectLiteralExpression, props: SettingProperties): boolean {
  const typeProp = valueObj.getProperty(TYPE_PROPERTY);
  if (typeProp?.getKind() === SyntaxKind.PropertyAssignment) {
    const typeInit = typeProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
    if (typeInit && isCustomTypeInNode(typeInit)) return true;
  }

  if (props.typeNode) {
    return isCustomTypeInNode(props.typeNode);
  }
  return false;
}
