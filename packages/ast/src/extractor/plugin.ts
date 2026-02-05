import type { SourceFile, TypeChecker, ObjectLiteralExpression, CallExpression } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import {
  asKind,
  extractStringLiteralValue,
  extractBooleanLiteralValue,
} from '../utils/node-helpers.js';
import { NAME_PROPERTY, DESCRIPTION_PROPERTY, IS_MODIFIED_PROPERTY } from './constants.js';
import type { ExtractedPluginInfo } from './types.js';
import { ExtractedPluginInfoSchema } from './types.js';
import { findDefinePluginCall } from '../navigator/plugin-navigator.js';

const getFirstObjectArg = (callExpr: CallExpression): ObjectLiteralExpression | undefined => {
  const args = callExpr.getArguments();
  return args.length > 0
    ? asKind<ObjectLiteralExpression>(args[0], SyntaxKind.ObjectLiteralExpression)
    : undefined;
};

export function extractPluginInfo(
  sourceFile: SourceFile,
  _checker: TypeChecker
): ExtractedPluginInfo {
  const call = findDefinePluginCall(sourceFile);
  const obj = call ? getFirstObjectArg(call) : undefined;

  if (!obj) return {};

  const name = extractStringLiteralValue(obj, NAME_PROPERTY);
  const description = extractStringLiteralValue(obj, DESCRIPTION_PROPERTY);
  const isModified = extractBooleanLiteralValue(obj, IS_MODIFIED_PROPERTY);

  return ExtractedPluginInfoSchema.parse({
    ...(name !== undefined && { name }),
    ...(description !== undefined && { description }),
    ...(isModified !== undefined && { isModified }),
  });
}
