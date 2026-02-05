import type {
  TypeChecker,
  Node,
  Identifier,
  CallExpression,
  PropertyAccessExpression,
  ObjectLiteralExpression,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';

import { asKind, iteratePropertyAssignments } from '../utils/node-helpers.js';
import {
  resolveIdentifier,
  resolveIdentifierWithFallback,
  resolveArrowBody,
  resolveToObjectLiteral,
} from '../foundation.js';

export { resolveIdentifierWithFallback };

export const resolveIdentifierInitializerNode = (
  node: Node,
  checker: TypeChecker
): Node | undefined => {
  const ident = asKind<Identifier>(node, SyntaxKind.Identifier);
  return ident ? resolveIdentifier(ident, checker) : undefined;
};

const resolvePropAccessMethod = (
  prop: PropertyAccessExpression,
  checker: TypeChecker
): Node | undefined => {
  const baseIdent = asKind<Identifier>(prop.getExpression(), SyntaxKind.Identifier);
  if (!baseIdent) return undefined;

  const obj = resolveToObjectLiteral(baseIdent, checker);
  if (!obj) return undefined;

  const methodProp = obj.getProperty(prop.getName());
  const propAssign =
    methodProp?.getKind() === SyntaxKind.PropertyAssignment
      ? methodProp.asKindOrThrow(SyntaxKind.PropertyAssignment)
      : undefined;
  const methodInit = propAssign?.getInitializer();
  return methodInit ? resolveArrowBody(methodInit) : undefined;
};

const resolveIdentCall = (ident: Identifier, checker: TypeChecker): Node | undefined =>
  resolveArrowBody(ident, checker);

export const resolveCallExpressionReturn = (node: Node, checker: TypeChecker): Node | undefined => {
  const call = asKind<CallExpression>(node, SyntaxKind.CallExpression);
  if (!call) return undefined;

  const expr = call.getExpression();
  if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
    return resolvePropAccessMethod(
      expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression),
      checker
    );
  }
  if (expr.getKind() === SyntaxKind.Identifier) {
    return resolveIdentCall(expr.asKindOrThrow(SyntaxKind.Identifier), checker);
  }
  return undefined;
};

const findConstText =
  (constName: string) =>
  (source: Node): string | null => {
    const cint = source
      .asKind(SyntaxKind.SourceFile)
      ?.getVariableDeclaration(constName)
      ?.getInitializer();
    return cint?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue() ?? null;
  };

const resolveThemeUrl =
  (nameNode: Node) =>
  (source: Node): string | null => {
    const name = nameNode.asKind(SyntaxKind.StringLiteral);
    if (!name) return null;
    const repo = findConstText('SHIKI_REPO')(source);
    const commit = findConstText('SHIKI_REPO_COMMIT')(source);
    return repo && commit
      ? `https://raw.githubusercontent.com/${repo}/${commit}/packages/tm-themes/themes/${name.getLiteralValue()}.json`
      : null;
  };

export const evaluateThemesValues = (themesIdent: Node, checker: TypeChecker): string[] => {
  if (themesIdent.getKind() !== SyntaxKind.Identifier) return [];

  const resolved = resolveIdentifierInitializerNode(themesIdent, checker);
  if (resolved === undefined) return [];

  if (resolved.getKind() !== SyntaxKind.ObjectLiteralExpression) return [];
  const obj = resolved.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);

  return Array.from(iteratePropertyAssignments(obj))
    .map((pa) => {
      const vinit = pa.getInitializer();
      if (!vinit) return null;

      if (vinit.getKind() === SyntaxKind.StringLiteral) {
        return vinit.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();
      }
      if (vinit.getKind() === SyntaxKind.CallExpression) {
        const call = vinit.asKindOrThrow(SyntaxKind.CallExpression);
        const calleeIdent = call.getExpression().asKind(SyntaxKind.Identifier);
        if (calleeIdent?.getText() === 'shikiRepoTheme') {
          const arg0Str = call.getArguments()[0]?.asKind(SyntaxKind.StringLiteral);
          return arg0Str ? resolveThemeUrl(arg0Str)(obj.getSourceFile()) : null;
        }
      }
      return null;
    })
    .filter((val): val is string => val !== null);
};
