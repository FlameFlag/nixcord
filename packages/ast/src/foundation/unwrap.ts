import type { Node } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';

export const unwrapNode = <T extends Node = Node>(node: T): T => {
  const asExpr = node.asKind(SyntaxKind.AsExpression);
  if (asExpr) return unwrapNode(asExpr.getExpression() as unknown as T);

  const typeAssert = node.asKind(SyntaxKind.TypeAssertionExpression);
  if (typeAssert) return unwrapNode(typeAssert.getExpression() as unknown as T);

  const satisfies = node.asKind(SyntaxKind.SatisfiesExpression);
  if (satisfies) return unwrapNode(satisfies.getExpression() as unknown as T);

  const paren = node.asKind(SyntaxKind.ParenthesizedExpression);
  if (paren) return unwrapNode(paren.getExpression() as unknown as T);

  return node;
};

export const getArrowFunctionBody = (node: Node): Node | undefined => {
  const arrow = node.asKind(SyntaxKind.ArrowFunction);
  if (!arrow) return undefined;
  const body = arrow.getBody();
  return body ? unwrapNode(body) : undefined;
};

export const getReturnedExpression = (node: Node): Node | undefined => {
  const unwrapped = unwrapNode(node);
  const block = unwrapped.asKind(SyntaxKind.Block);
  if (!block) return unwrapped;
  return block.getDescendantsOfKind(SyntaxKind.ReturnStatement)[0]?.getExpression();
};
