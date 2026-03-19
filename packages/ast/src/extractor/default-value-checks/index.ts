import type {
  TypeChecker,
  ObjectLiteralExpression,
  Node,
  ArrayLiteralExpression,
  AsExpression,
  Identifier,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { STRING_ARRAY_TYPE_PATTERN, COMPONENT_PROPERTY } from '../constants.js';
import { unwrapNode, resolveSymbolInit, resolveArrowBody, asKind } from '../../foundation/index.js';
import { getDefaultPropertyInitializer } from '../type-helpers.js';

const isStringArray = (arr: ArrayLiteralExpression): boolean =>
  arr.getElements().every((el) => el.getKind() === SyntaxKind.StringLiteral);

const isStringArrayAsExpr = (asExpr: AsExpression): boolean =>
  !!asExpr.getTypeNode() &&
  STRING_ARRAY_TYPE_PATTERN.test(asExpr.getTypeNode()!.getText()) &&
  asKind<ArrayLiteralExpression>(asExpr.getExpression(), SyntaxKind.ArrayLiteralExpression) !==
    undefined;

const checkStringArrayInit = (init: Node): boolean => {
  switch (init.getKind()) {
    case SyntaxKind.ArrayLiteralExpression: {
      const arr = asKind<ArrayLiteralExpression>(init, SyntaxKind.ArrayLiteralExpression);
      return arr ? isStringArray(arr) : false;
    }
    case SyntaxKind.AsExpression: {
      const expr = asKind<AsExpression>(init, SyntaxKind.AsExpression);
      return expr ? isStringArrayAsExpr(expr) : false;
    }
    default:
      return false;
  }
};

const getIdentifierInit = (ident: Identifier): Node | undefined => resolveSymbolInit(ident);

export function hasStringArrayDefault(obj: ObjectLiteralExpression): boolean {
  const init = getDefaultPropertyInitializer(obj);
  if (!init) return false;

  if (init.getKind() === SyntaxKind.Identifier) {
    const ident = asKind<Identifier>(init, SyntaxKind.Identifier);
    if (!ident) return false;
    const valueInit = getIdentifierInit(ident);
    return valueInit ? checkStringArrayInit(valueInit) : false;
  }
  return checkStringArrayInit(init);
}

export function resolveIdentifierArrayDefault(obj: ObjectLiteralExpression): boolean {
  const init = getDefaultPropertyInitializer(obj);
  if (!init || init.getKind() !== SyntaxKind.Identifier) return false;
  const ident = asKind<Identifier>(init, SyntaxKind.Identifier);
  if (!ident) return false;
  const valueInit = getIdentifierInit(ident);
  if (!valueInit) return false;

  switch (valueInit.getKind()) {
    case SyntaxKind.ArrayLiteralExpression: {
      const arr = asKind<ArrayLiteralExpression>(valueInit, SyntaxKind.ArrayLiteralExpression);
      return arr ? isStringArray(arr) : false;
    }
    case SyntaxKind.AsExpression: {
      const arr = asKind<ArrayLiteralExpression>(
        valueInit.asKindOrThrow(SyntaxKind.AsExpression).getExpression(),
        SyntaxKind.ArrayLiteralExpression
      );
      return arr ? isStringArray(arr) : false;
    }
    default:
      return false;
  }
}

const isArrayExprWithObjects = (node: Node): boolean => {
  const arr = asKind<ArrayLiteralExpression>(node, SyntaxKind.ArrayLiteralExpression);
  return arr
    ? arr.getElements().length > 0 &&
        arr.getElements().every((el) => el.getKind() === SyntaxKind.ObjectLiteralExpression)
    : false;
};

export function hasObjectArrayDefault(obj: ObjectLiteralExpression, checker: TypeChecker): boolean {
  const init = getDefaultPropertyInitializer(obj);
  if (!init) return false;

  switch (init.getKind()) {
    case SyntaxKind.ArrayLiteralExpression:
      return isArrayExprWithObjects(init);
    case SyntaxKind.AsExpression: {
      const asExpr = init.asKindOrThrow(SyntaxKind.AsExpression);
      const typeNode = asExpr.getTypeNode();
      const isArrayType =
        !!typeNode &&
        (/\[\]$/.test(typeNode.getText()) || /\bArray<.+>\b/.test(typeNode.getText()));
      return isArrayType ? isArrayExprWithObjects(asExpr.getExpression()) : false;
    }
    case SyntaxKind.CallExpression: {
      const ident = init
        .asKindOrThrow(SyntaxKind.CallExpression)
        .getExpression()
        .asKind(SyntaxKind.Identifier);
      if (!ident) return false;
      const body = resolveArrowBody(ident);
      return body ? isArrayExprWithObjects(unwrapNode(body)) : false;
    }
    case SyntaxKind.Identifier: {
      const ident = asKind<Identifier>(init, SyntaxKind.Identifier);
      if (!ident) return false;
      const valueInit = resolveSymbolInit(ident, checker);
      if (!valueInit) return false;
      return isArrayExprWithObjects(unwrapNode(valueInit));
    }
    default:
      return false;
  }
}

export function hasComponentProp(obj: ObjectLiteralExpression): boolean {
  return obj.getProperty(COMPONENT_PROPERTY) !== undefined;
}

export function hasEmptyArrayWithTypeAnnotation(obj: ObjectLiteralExpression): boolean {
  const init = getDefaultPropertyInitializer(obj);
  if (!init) return false;

  switch (init.getKind()) {
    case SyntaxKind.AsExpression: {
      const asExpr = init.asKindOrThrow(SyntaxKind.AsExpression);
      const expr = asExpr.getExpression();
      const typeNode = asExpr.getTypeNode();
      return (
        !!typeNode &&
        !!expr &&
        expr.getKind() === SyntaxKind.ArrayLiteralExpression &&
        (/\[\]$/.test(typeNode.getText()) || /\bArray<.+>\b/.test(typeNode.getText())) &&
        expr.asKindOrThrow(SyntaxKind.ArrayLiteralExpression).getElements().length === 0
      );
    }
    case SyntaxKind.CallExpression: {
      const callExpr = init.asKindOrThrow(SyntaxKind.CallExpression);
      const ident = callExpr.getExpression().asKind(SyntaxKind.Identifier);
      if (!ident) return false;

      const funcBody = resolveArrowBody(ident);
      if (!funcBody) return false;
      const unwrapped = unwrapNode(funcBody);
      if (unwrapped.getKind() !== SyntaxKind.ArrayLiteralExpression) return false;

      const arr = unwrapped.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
      const elems = arr.getElements();
      return (
        elems.length === 0 ||
        elems.every(
          (el) =>
            el.getKind() === SyntaxKind.ObjectLiteralExpression ||
            el.getKind() === SyntaxKind.CallExpression
        )
      );
    }
    default:
      return false;
  }
}
