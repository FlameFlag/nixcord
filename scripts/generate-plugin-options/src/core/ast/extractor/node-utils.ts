import type {
  TypeChecker,
  Node,
  Identifier,
  CallExpression,
  PropertyAccessExpression,
  ObjectLiteralExpression,
  StringLiteral,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { Maybe, Result } from 'true-myth';
import { match, P } from 'ts-pattern';
import { pipe, filter, map, find } from 'remeda';
import { asKind, iteratePropertyAssignments } from '../utils/node-helpers.js';
import { unwrapNode, resolveIdentifier } from '../foundation.js';

export const resolveIdentifierInitializerNode = (node: Node, checker: TypeChecker): Maybe<Node> => {
  const ident = asKind<Identifier>(node, SyntaxKind.Identifier).unwrapOr(undefined);
  return ident ? resolveIdentifier(ident, checker) : Maybe.nothing();
};

export const resolveIdentifierWithFallback = (
  node: Node,
  checker: TypeChecker
): Node | undefined => {
  const ident = asKind<Identifier>(node, SyntaxKind.Identifier).unwrapOr(undefined);
  if (!ident) return undefined;

  const resolved = resolveIdentifierInitializerNode(ident, checker);
  if (resolved.isJust) return resolved.value;

  const sourceFile = ident.getSourceFile();
  const identName = ident.getText();
  const valueDecl =
    sourceFile.getVariableDeclaration(identName) ??
    find(
      sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration),
      (d) => d.getNameNode().getText() === identName
    );

  return valueDecl && 'getInitializer' in valueDecl
    ? (valueDecl as { getInitializer: () => Node | undefined }).getInitializer()
    : undefined;
};

const getValueDecl = (symbol: any): any =>
  symbol?.getValueDeclaration() ?? symbol?.getAliasedSymbol?.()?.getValueDeclaration?.();

const extractArrowBody = (node: any): Maybe<Node> =>
  node.getKind() === SyntaxKind.ArrowFunction
    ? Maybe.just(unwrapNode(node.getBody()))
    : Maybe.nothing();

const getArrowBodyFromInit = (decl: any): Maybe<Node> => {
  if (!decl?.getInitializer) return Maybe.nothing();
  return extractArrowBody(decl.getInitializer());
};

const resolvePropAccessMethod = (
  prop: PropertyAccessExpression,
  checker: TypeChecker
): Maybe<Node> => {
  const baseIdent = asKind<Identifier>(prop.getExpression(), SyntaxKind.Identifier).unwrapOr(
    undefined
  );
  if (!baseIdent) return Maybe.nothing();

  const baseDecl = getValueDecl(baseIdent.getSymbol() ?? checker.getSymbolAtLocation(baseIdent));
  const baseInit = baseDecl?.getInitializer?.();
  if (!baseInit) return Maybe.nothing();

  const obj = asKind<ObjectLiteralExpression>(
    baseInit,
    SyntaxKind.ObjectLiteralExpression
  ).unwrapOr(undefined);
  if (!obj) return Maybe.nothing();

  const methodProp = obj.getProperty(prop.getName());
  const propAssign =
    methodProp?.getKind() === SyntaxKind.PropertyAssignment
      ? methodProp.asKindOrThrow(SyntaxKind.PropertyAssignment)
      : undefined;
  const methodInit = propAssign?.getInitializer();
  return methodInit?.getKind() === SyntaxKind.ArrowFunction
    ? extractArrowBody(methodInit)
    : Maybe.nothing();
};

const resolveIdentCall = (ident: Identifier, checker: TypeChecker): Maybe<Node> => {
  const decl = getValueDecl(ident.getSymbol() ?? checker.getSymbolAtLocation(ident));
  if (!decl) return Maybe.nothing();
  return extractArrowBody(decl).orElse(() => getArrowBodyFromInit(decl));
};

export const resolveCallExpressionReturn = (node: Node, checker: TypeChecker): Maybe<Node> => {
  const call = asKind<CallExpression>(node, SyntaxKind.CallExpression).unwrapOr(undefined);
  if (!call) return Maybe.nothing();

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
  return Maybe.nothing();
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

  return resolveIdentifierInitializerNode(themesIdent, checker)
    .map((node) => {
      if (node.getKind() !== SyntaxKind.ObjectLiteralExpression) return [];
      const obj = node.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);

      return pipe(
        Array.from(iteratePropertyAssignments(obj)),
        map((pa) => {
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
        }),
        filter((val): val is string => val !== null)
      );
    })
    .unwrapOr([]);
};

export const hasProperty = (obj: ObjectLiteralExpression, propName: string): boolean =>
  obj.getProperty(propName) !== undefined;
