import type { SourceFile, TypeChecker, ObjectLiteralExpression, CallExpression } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { Maybe } from 'true-myth';
import { asKind, extractStringLiteralValue, extractBooleanLiteralValue } from '../utils/node-helpers.js';
import { NAME_PROPERTY, DESCRIPTION_PROPERTY, IS_MODIFIED_PROPERTY } from './constants.js';
import type { ExtractedPluginInfo } from './types.js';
import { ExtractedPluginInfoSchema } from './types.js';
import { findDefinePluginCall } from '../navigator/plugin-navigator.js';

const getFirstObjectArg = (callExpr: CallExpression): Maybe<ObjectLiteralExpression> => {
  const args = callExpr.getArguments();
  return args.length > 0
    ? asKind<ObjectLiteralExpression>(args[0], SyntaxKind.ObjectLiteralExpression)
    : Maybe.nothing();
};

export function extractPluginInfo(sourceFile: SourceFile, _checker: TypeChecker): ExtractedPluginInfo {
  const obj = findDefinePluginCall(sourceFile)
    .andThen(getFirstObjectArg)
    .unwrapOr(undefined);

  if (!obj) return {};

  const name = extractStringLiteralValue(obj, NAME_PROPERTY).unwrapOr(undefined);
  const description = extractStringLiteralValue(obj, DESCRIPTION_PROPERTY).unwrapOr(undefined);
  const isModified = extractBooleanLiteralValue(obj, IS_MODIFIED_PROPERTY).unwrapOr(undefined);

  return ExtractedPluginInfoSchema.parse({
    ...(name !== undefined && { name }),
    ...(description !== undefined && { description }),
    ...(isModified !== undefined && { isModified }),
  });
}
