import type { TypeChecker, ObjectLiteralExpression, Node, ArrayLiteralExpression, AsExpression, Identifier } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { isEmpty } from 'remeda';
import { match } from 'ts-pattern';
import { Maybe } from 'true-myth';
import { STRING_ARRAY_TYPE_PATTERN, COMPONENT_PROPERTY } from '../constants.js';
import { unwrapNode } from '../../foundation.js';
import { getDefaultPropertyInitializer } from '../type-helpers.js';
import { asKind } from '../../utils/node-helpers.js';

const isStringArray = (arr: ArrayLiteralExpression): boolean =>
  arr.getElements().every(el => el.getKind() === SyntaxKind.StringLiteral);

const isStringArrayAsExpr = (asExpr: AsExpression): boolean =>
  !!asExpr.getTypeNode() &&
  STRING_ARRAY_TYPE_PATTERN.test(asExpr.getTypeNode()!.getText()) &&
  asKind<ArrayLiteralExpression>(asExpr.getExpression(), SyntaxKind.ArrayLiteralExpression).isJust;

const checkStringArrayInit = (init: Node): boolean =>
  match(init.getKind())
    .with(SyntaxKind.ArrayLiteralExpression, () =>
      asKind<ArrayLiteralExpression>(init, SyntaxKind.ArrayLiteralExpression).map(isStringArray).unwrapOr(false))
    .with(SyntaxKind.AsExpression, () =>
      asKind<AsExpression>(init, SyntaxKind.AsExpression).map(isStringArrayAsExpr).unwrapOr(false))
    .otherwise(() => false);

const getIdentifierInit = (ident: Identifier): Node | undefined => {
  const valueDecl = ident.getSymbol()?.getValueDeclaration();
  return valueDecl && 'getInitializer' in valueDecl
    ? (valueDecl as { getInitializer: () => Node | undefined }).getInitializer()
    : undefined;
};

export function hasStringArrayDefault(obj: ObjectLiteralExpression): boolean {
  const init = getDefaultPropertyInitializer(obj);
  if (!init) return false;

  if (init.getKind() === SyntaxKind.Identifier) {
    const ident = asKind<Identifier>(init, SyntaxKind.Identifier).unwrapOr(undefined);
    if (!ident) return false;
    const valueInit = getIdentifierInit(ident);
    return valueInit ? checkStringArrayInit(valueInit) : false;
  }
  return checkStringArrayInit(init);
}

export function resolveIdentifierArrayDefault(obj: ObjectLiteralExpression): boolean {
  const init = getDefaultPropertyInitializer(obj);
  if (!init || init.getKind() !== SyntaxKind.Identifier) return false;
  const ident = asKind<Identifier>(init, SyntaxKind.Identifier).unwrapOr(undefined);
  if (!ident) return false;
  const valueInit = getIdentifierInit(ident);
  if (!valueInit) return false;

  return match(valueInit.getKind())
    .with(SyntaxKind.ArrayLiteralExpression, () =>
      asKind<ArrayLiteralExpression>(valueInit, SyntaxKind.ArrayLiteralExpression).map(isStringArray).unwrapOr(false))
    .with(SyntaxKind.AsExpression, () =>
      asKind<ArrayLiteralExpression>(valueInit.asKindOrThrow(SyntaxKind.AsExpression).getExpression(), SyntaxKind.ArrayLiteralExpression).map(isStringArray).unwrapOr(false))
    .otherwise(() => false);
}

const isArrayExprWithObjects = (node: Node): boolean =>
  asKind<ArrayLiteralExpression>(node, SyntaxKind.ArrayLiteralExpression)
    .map(arr => !isEmpty(arr.getElements()) && arr.getElements().every(el => el.getKind() === SyntaxKind.ObjectLiteralExpression))
    .unwrapOr(false);

const resolveFuncBody = (node: Node): Maybe<Node> => {
  if (node.getKind() !== SyntaxKind.Identifier) return Maybe.nothing();
  const ident = node.asKindOrThrow(SyntaxKind.Identifier);
  const symbol = ident.getSymbol();
  let valueDecl = symbol?.getValueDeclaration();
  try {
    if (!valueDecl && (symbol as any)?.getAliasedSymbol) {
      valueDecl = (symbol as any).getAliasedSymbol?.()?.getValueDeclaration?.();
    }
  } catch {}
  if (!valueDecl) return Maybe.nothing();

  if (valueDecl.getKind() === SyntaxKind.ArrowFunction) {
    return Maybe.just(unwrapNode(valueDecl.asKindOrThrow(SyntaxKind.ArrowFunction).getBody()));
  }
  if ('getInitializer' in valueDecl) {
    const vInit = (valueDecl as { getInitializer: () => Node | undefined }).getInitializer();
    if (vInit?.getKind() === SyntaxKind.ArrowFunction) {
      return Maybe.just(unwrapNode(vInit.asKindOrThrow(SyntaxKind.ArrowFunction).getBody()));
    }
  }
  const decl = ident.getSourceFile().getVariableDeclaration(ident.getText());
  const vInit = decl?.getInitializer();
  if (vInit?.getKind() === SyntaxKind.ArrowFunction) {
    return Maybe.just(unwrapNode(vInit.asKindOrThrow(SyntaxKind.ArrowFunction).getBody()));
  }
  return Maybe.nothing();
};

export function hasObjectArrayDefault(obj: ObjectLiteralExpression, checker: TypeChecker): boolean {
  const init = getDefaultPropertyInitializer(obj);
  if (!init) return false;

  return match(init.getKind())
    .with(SyntaxKind.ArrayLiteralExpression, () => isArrayExprWithObjects(init))
    .with(SyntaxKind.AsExpression, () => {
      const asExpr = init.asKindOrThrow(SyntaxKind.AsExpression);
      const typeNode = asExpr.getTypeNode();
      const isArrayType = !!typeNode && (/\[\]$/.test(typeNode.getText()) || /\bArray<.+>\b/.test(typeNode.getText()));
      return isArrayType ? isArrayExprWithObjects(asExpr.getExpression()) : false;
    })
    .with(SyntaxKind.CallExpression, () => {
      const ident = init.asKindOrThrow(SyntaxKind.CallExpression).getExpression().asKind(SyntaxKind.Identifier);
      return ident ? resolveFuncBody(ident).map(b => isArrayExprWithObjects(unwrapNode(b))).unwrapOr(false) : false;
    })
    .with(SyntaxKind.Identifier, () => {
      const ident = asKind<Identifier>(init, SyntaxKind.Identifier).unwrapOr(undefined);
      if (!ident) return false;
      const symbol = ident.getSymbol() ?? checker.getSymbolAtLocation(ident);
      const valueDecl = symbol?.getValueDeclaration();
      const valueInit = valueDecl && 'getInitializer' in valueDecl ? (valueDecl as { getInitializer: () => Node | undefined }).getInitializer() : undefined;
      if (!valueInit) return false;

      const unwrapped = valueInit.getKind() === SyntaxKind.AsExpression
        ? valueInit.asKindOrThrow(SyntaxKind.AsExpression).getExpression()
        : valueInit;

      return asKind<ArrayLiteralExpression>(unwrapped, SyntaxKind.ArrayLiteralExpression)
        .map(isArrayExprWithObjects)
        .unwrapOr(false);
    })
    .otherwise(() => false);
}

export function hasComponentProp(obj: ObjectLiteralExpression): boolean {
  return obj.getProperty(COMPONENT_PROPERTY) !== undefined;
}

export function hasEmptyArrayWithTypeAnnotation(obj: ObjectLiteralExpression): boolean {
  const init = getDefaultPropertyInitializer(obj);
  if (!init) return false;

  return match(init.getKind())
    .with(SyntaxKind.AsExpression, () => {
      const asExpr = init.asKindOrThrow(SyntaxKind.AsExpression);
      const expr = asExpr.getExpression();
      const typeNode = asExpr.getTypeNode();
      return !!typeNode &&
        !!expr &&
        expr.getKind() === SyntaxKind.ArrayLiteralExpression &&
        (/\[\]$/.test(typeNode.getText()) || /\bArray<.+>\b/.test(typeNode.getText())) &&
        expr.asKindOrThrow(SyntaxKind.ArrayLiteralExpression).getElements().length === 0;
    })
    .with(SyntaxKind.CallExpression, () => {
      const callExpr = init.asKindOrThrow(SyntaxKind.CallExpression);
      const ident = callExpr.getExpression().asKind(SyntaxKind.Identifier);
      if (!ident) return false;

      const symbol = ident.getSymbol();
      if (!symbol) return false;

      let valueDecl = symbol.getValueDeclaration();
      if (!valueDecl && (symbol as any).getAliasedSymbol) {
        try {
          valueDecl = (symbol as any).getAliasedSymbol()?.getValueDeclaration?.();
        } catch {}
      }
      if (!valueDecl) return false;

      let funcBody: Node | undefined;
      if (valueDecl.getKind() === SyntaxKind.ArrowFunction) {
        funcBody = valueDecl.asKindOrThrow(SyntaxKind.ArrowFunction).getBody();
      } else if ('getInitializer' in valueDecl) {
        const valueInit = (valueDecl as { getInitializer: () => Node | undefined }).getInitializer();
        if (valueInit?.getKind() === SyntaxKind.ArrowFunction) {
          funcBody = valueInit.asKindOrThrow(SyntaxKind.ArrowFunction).getBody();
        }
      }

      if (!funcBody) return false;
      const unwrapped = unwrapNode(funcBody);
      if (unwrapped.getKind() !== SyntaxKind.ArrayLiteralExpression) return false;

      const arr = unwrapped.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
      const elems = arr.getElements();
      return isEmpty(elems) || elems.every(el => el.getKind() === SyntaxKind.ObjectLiteralExpression || el.getKind() === SyntaxKind.CallExpression);
    })
    .otherwise(() => false);
}
