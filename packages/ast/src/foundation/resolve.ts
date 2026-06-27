import type {
  Identifier,
  Node,
  ObjectLiteralExpression,
  PropertyAccessExpression,
  Symbol as TsMorphSymbol,
  TypeChecker,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { iteratePropertyAssignments } from './property.js';
import { unwrapNode } from './unwrap.js';

const resolveSymbol = (
  node: Node,
  checker?: TypeChecker
): { symbol: TsMorphSymbol | undefined; valueDecl: Node | undefined } => {
  const symbol = node.getSymbol() ?? (checker ? checker.getSymbolAtLocation(node) : undefined);
  if (!symbol) return { symbol: undefined, valueDecl: undefined };
  const safeAliasedDecl = (): Node | undefined => {
    try {
      return symbol.getAliasedSymbol()?.getValueDeclaration?.();
    } catch {
      return undefined;
    }
  };
  const valueDecl = symbol.getValueDeclaration() ?? safeAliasedDecl();
  return { symbol, valueDecl };
};

export const resolveValueDeclaration = (node: Node, checker?: TypeChecker): Node | undefined =>
  resolveSymbol(node, checker).valueDecl;

const getInitializerFromDecl = (valueDecl?: Node): Node | undefined =>
  valueDecl && 'getInitializer' in valueDecl
    ? (valueDecl as { getInitializer: () => Node | undefined }).getInitializer()
    : undefined;

export const resolveSymbolInit = (node: Node, checker?: TypeChecker): Node | undefined => {
  const symbolResult = resolveSymbol(node, checker);
  return getInitializerFromDecl(symbolResult.valueDecl);
};

const resolveIdentifier = (identifier: Identifier, checker: TypeChecker): Node | undefined => {
  const symbol = identifier.getSymbol() ?? checker.getSymbolAtLocation(identifier);
  if (!symbol) return undefined;

  const valueDecl = symbol.getValueDeclaration();
  const aliasedValueDecl = symbol.getAliasedSymbol()?.getValueDeclaration?.();
  const varDecl =
    valueDecl?.asKind(SyntaxKind.VariableDeclaration) ??
    aliasedValueDecl?.asKind(SyntaxKind.VariableDeclaration);
  if (varDecl) {
    const init = varDecl.getInitializer();
    return init ? unwrapNode(init) : undefined;
  }
  return undefined;
};

const resolveNode = (node: Node, checker: TypeChecker): Node | undefined => {
  const ident = node.asKind(SyntaxKind.Identifier);
  if (!ident) return undefined;
  return resolveIdentifier(ident, checker);
};

export const resolveIdentifierInitializerNode = (
  node: Node,
  checker: TypeChecker
): Node | undefined => resolveNode(node, checker);

const resolveIdentifierNode = (node: Node, checker: TypeChecker): Node =>
  resolveNode(node, checker) ?? node;

export const resolveIdentifierWithFallback = (
  node: Node,
  checker: TypeChecker
): Node | undefined => {
  const identifier = node.asKind(SyntaxKind.Identifier);
  if (!identifier) return undefined;

  const resolved = resolveNode(node, checker);
  if (resolved !== undefined) return resolved;

  const sourceFile = identifier.getSourceFile();
  const identName = identifier.getText();
  const decl =
    sourceFile.getVariableDeclaration(identName) ??
    sourceFile
      .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
      .find((d) => d.getNameNode().getText() === identName);
  const init = decl?.getInitializer();
  return init ? unwrapNode(init) : undefined;
};

export const resolveArrowBody = (node: Node, checker?: TypeChecker): Node | undefined => {
  const arrow = node.asKind(SyntaxKind.ArrowFunction);
  if (arrow) return unwrapNode(arrow.getBody());

  const ident = node.asKind(SyntaxKind.Identifier);
  if (ident) {
    const symbolResult = resolveSymbol(node, checker);
    if (!symbolResult.valueDecl) {
      const decl = ident.getSourceFile().getVariableDeclaration(ident.getText());
      const initArrow = decl?.getInitializer()?.asKind(SyntaxKind.ArrowFunction);
      return initArrow ? unwrapNode(initArrow.getBody()) : undefined;
    }
    const declArrow = symbolResult.valueDecl.asKind(SyntaxKind.ArrowFunction);
    if (declArrow) return unwrapNode(declArrow.getBody());
    const initArrow = getInitializerFromDecl(symbolResult.valueDecl)?.asKind(
      SyntaxKind.ArrowFunction
    );
    if (initArrow) return unwrapNode(initArrow.getBody());
  }
  return undefined;
};

export const resolveToObjectLiteral = (
  node: Node,
  checker: TypeChecker
): ObjectLiteralExpression | undefined => {
  let resolved: Node | undefined = node;
  if (node.getKind() === SyntaxKind.Identifier) {
    resolved = resolveNode(node, checker);
    if (!resolved) {
      const symbolResult = resolveSymbol(node, checker);
      resolved =
        getInitializerFromDecl(symbolResult.valueDecl) ??
        resolveIdentifierWithFallback(node, checker);
    }
  }
  if (!resolved) return undefined;
  const unwrapped = unwrapNode(resolved);
  return unwrapped.asKind(SyntaxKind.ObjectLiteralExpression);
};

const resolvePropAccessMethod = (
  prop: PropertyAccessExpression,
  checker: TypeChecker
): Node | undefined => {
  const baseIdent = prop.getExpression().asKind(SyntaxKind.Identifier);
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

export const resolveCallExpressionReturn = (node: Node, checker: TypeChecker): Node | undefined => {
  const call = node.asKind(SyntaxKind.CallExpression);
  if (!call) return undefined;

  const expr = call.getExpression();
  if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
    return resolvePropAccessMethod(
      expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression),
      checker
    );
  }
  if (expr.getKind() === SyntaxKind.Identifier) {
    return resolveArrowBody(expr.asKindOrThrow(SyntaxKind.Identifier), checker);
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
