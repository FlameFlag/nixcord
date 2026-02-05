/**
 * Type definitions for type inference.
 */

import type { Node } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { getPropertyInitializer, extractBooleanLiteralValue } from '../../utils/node-helpers.js';

export interface SettingProperties {
  typeNode: ReturnType<typeof getPropertyInitializerForType>;
  description: string | undefined;
  placeholder: string | undefined;
  restartNeeded: boolean;
  hidden: ReturnType<typeof extractBooleanLiteralValueForHidden>;
  defaultLiteralValue: unknown;
}

const getPropertyInitializerForType = (node: Node, propName: string) => {
  if (node.getKind() !== SyntaxKind.ObjectLiteralExpression) {
    return undefined;
  }
  const objLiteral = node.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  return getPropertyInitializer(objLiteral, propName);
};

const extractBooleanLiteralValueForHidden = (node: Node, propName: string) => {
  if (node.getKind() !== SyntaxKind.ObjectLiteralExpression) {
    return undefined;
  }
  const objLiteral = node.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  return extractBooleanLiteralValue(objLiteral, propName);
};

export interface TypeInferenceResult {
  finalNixType: string;
  selectEnumValues: readonly (string | number | boolean)[] | undefined;
  defaultValue: unknown;
}
