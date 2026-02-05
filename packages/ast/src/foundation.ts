import type {
  Node,
  TypeChecker,
  Identifier,
  ObjectLiteralExpression,
  Symbol as TsMorphSymbol,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { type Result, Ok, Err } from '@nixcord/shared';

export type EnumLiteral = string | number | boolean;

export interface EvaluationError {
  kind: 'EvaluationError';
  message: string;
  node: Node;
}

export const createEvaluationError = (message: string, node: Node): EvaluationError => ({
  kind: 'EvaluationError',
  message,
  node,
});

export type EvaluationResult = Result<EnumLiteral, EvaluationError>;

export const isLiteralKind = (kind: SyntaxKind): boolean =>
  kind === SyntaxKind.StringLiteral ||
  kind === SyntaxKind.NumericLiteral ||
  kind === SyntaxKind.NoSubstitutionTemplateLiteral ||
  kind === SyntaxKind.TrueKeyword ||
  kind === SyntaxKind.FalseKeyword;

export const isCollectionKind = (kind: SyntaxKind): boolean =>
  kind === SyntaxKind.ArrayLiteralExpression || kind === SyntaxKind.ObjectLiteralExpression;

export const isEmptyValue = (value: unknown): boolean =>
  value === null || value === undefined || value === '' || value === 0 || value === false;

export const unwrapNode = <T extends Node = Node>(node: T): T => {
  const asExpr = node.asKind(SyntaxKind.AsExpression);
  if (asExpr) return unwrapNode(asExpr.getExpression() as unknown as T);

  const typeAssert = node.asKind(SyntaxKind.TypeAssertionExpression);
  if (typeAssert) return unwrapNode(typeAssert.getExpression() as unknown as T);

  const paren = node.asKind(SyntaxKind.ParenthesizedExpression);
  if (paren) return unwrapNode(paren.getExpression() as unknown as T);

  return node;
};

export const isWrappedNode = (node: Node): boolean =>
  node.getKind() === SyntaxKind.AsExpression ||
  node.getKind() === SyntaxKind.TypeAssertionExpression ||
  node.getKind() === SyntaxKind.ParenthesizedExpression;

export const getArrowFunctionBody = (node: Node): Node | undefined => {
  const arrow = node.asKind(SyntaxKind.ArrowFunction);
  if (!arrow) return undefined;
  const body = arrow.getBody();
  return body ? unwrapNode(body) : undefined;
};

export const evaluateLiteral = (node: Node): EvaluationResult => {
  const unwrapped = unwrapNode(node);
  const kind = unwrapped.getKind();

  if (kind === SyntaxKind.StringLiteral) {
    return Ok(unwrapped.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue());
  }
  if (kind === SyntaxKind.NumericLiteral) {
    return Ok(unwrapped.asKindOrThrow(SyntaxKind.NumericLiteral).getLiteralValue());
  }
  if (kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return Ok(unwrapped.asKindOrThrow(SyntaxKind.NoSubstitutionTemplateLiteral).getLiteralValue());
  }
  if (kind === SyntaxKind.TrueKeyword) return Ok(true);
  if (kind === SyntaxKind.FalseKeyword) return Ok(false);

  return Err(
    createEvaluationError(`Expected literal value, got ${unwrapped.getKindName()}`, unwrapped)
  );
};

export const isLiteralNode = (node: Node): boolean => isLiteralKind(unwrapNode(node).getKind());

export const resolveIdentifier = (
  identifier: Identifier,
  checker: TypeChecker
): Node | undefined => {
  const symbol = identifier.getSymbol() ?? checker.getSymbolAtLocation(identifier);
  if (!symbol) return undefined;

  const valueDecl = symbol.getValueDeclaration();
  if (!valueDecl) return undefined;

  const varDecl = valueDecl.asKind(SyntaxKind.VariableDeclaration);
  if (varDecl) {
    const init = varDecl.getInitializer();
    return init ? unwrapNode(init) : undefined;
  }
  return undefined;
};

export const resolveIdentifierNode = (node: Node, checker: TypeChecker): Node => {
  const ident = node.asKind(SyntaxKind.Identifier);
  if (!ident) return node;
  const resolved = resolveIdentifier(ident, checker);
  return resolved !== undefined ? resolved : node;
};

export const resolveIdentifierWithFallback = (
  node: Node,
  checker: TypeChecker
): Node | undefined => {
  const identifier = node.asKind(SyntaxKind.Identifier);
  if (!identifier) return undefined;
  const resolved = resolveIdentifier(identifier, checker);
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

export const resolveSymbol = (
  node: Node,
  checker?: TypeChecker
): { symbol: TsMorphSymbol | undefined; valueDecl: Node | undefined } => {
  const symbol = node.getSymbol() ?? (checker ? checker.getSymbolAtLocation(node) : undefined);
  if (!symbol) return { symbol: undefined, valueDecl: undefined };
  let valueDecl = symbol.getValueDeclaration();
  try {
    if (!valueDecl) {
      valueDecl = symbol.getAliasedSymbol()?.getValueDeclaration?.();
    }
  } catch {}
  return { symbol, valueDecl };
};

export const getInitializerFromDecl = (valueDecl?: Node): Node | undefined =>
  valueDecl && 'getInitializer' in valueDecl
    ? (valueDecl as { getInitializer: () => Node | undefined }).getInitializer()
    : undefined;

export const resolveArrowBody = (node: Node, checker?: TypeChecker): Node | undefined => {
  const arrow = node.asKind(SyntaxKind.ArrowFunction);
  if (arrow) return unwrapNode(arrow.getBody());

  const ident = node.asKind(SyntaxKind.Identifier);
  if (ident) {
    const { valueDecl } = resolveSymbol(node, checker);
    if (!valueDecl) {
      const decl = ident.getSourceFile().getVariableDeclaration(ident.getText());
      const initArrow = decl?.getInitializer()?.asKind(SyntaxKind.ArrowFunction);
      return initArrow ? unwrapNode(initArrow.getBody()) : undefined;
    }
    const declArrow = valueDecl.asKind(SyntaxKind.ArrowFunction);
    if (declArrow) return unwrapNode(declArrow.getBody());
    const initArrow = getInitializerFromDecl(valueDecl)?.asKind(SyntaxKind.ArrowFunction);
    if (initArrow) return unwrapNode(initArrow.getBody());
  }
  return undefined;
};

export const resolveToObjectLiteral = (
  node: Node,
  checker: TypeChecker
): ObjectLiteralExpression | undefined => {
  let resolved: Node | undefined;
  if (node.getKind() === SyntaxKind.Identifier) {
    const { valueDecl } = resolveSymbol(node, checker);
    const init = getInitializerFromDecl(valueDecl);
    if (init) {
      resolved = init;
    } else {
      resolved = resolveIdentifierWithFallback(node, checker);
    }
  } else {
    resolved = node;
  }
  if (!resolved) return undefined;
  const unwrapped = unwrapNode(resolved);
  return unwrapped.asKind(SyntaxKind.ObjectLiteralExpression);
};

const EXTERNAL_ENUMS: Record<string, Record<string, number>> = {
  ActivityType: { PLAYING: 0, STREAMING: 1, LISTENING: 2, WATCHING: 3, CUSTOM: 4, COMPETING: 5 },
  StatusType: { ONLINE: 0, IDLE: 1, DND: 2, INVISIBLE: 3 },
  ChannelType: { GUILD_TEXT: 0, DM: 1, GUILD_VOICE: 2 },
};

const getExternalEnumValue = (enumName: string, member: string): number | undefined =>
  EXTERNAL_ENUMS[enumName]?.[member];

export const evaluatePropertyAccess = (
  node: Node,
  checker: TypeChecker,
  evaluateValue: (n: Node, c: TypeChecker) => EvaluationResult
): EvaluationResult => {
  if (node.getKind() !== SyntaxKind.PropertyAccessExpression) {
    return Err(
      createEvaluationError(`Expected PropertyAccessExpression, got ${node.getKindName()}`, node)
    );
  }

  const propAccess = node.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
  const symbol = propAccess.getSymbol() ?? checker.getSymbolAtLocation(propAccess);
  const valueDecl = symbol?.getValueDeclaration();

  const enumMember = valueDecl?.asKind(SyntaxKind.EnumMember);
  if (enumMember) {
    const value = enumMember.getValue();
    if (typeof value === 'number' || typeof value === 'string') return Ok(value);

    const init = enumMember.getInitializer();
    if (init) return evaluateValue(init, checker);
  }

  const baseExpr = propAccess.getExpression();
  const baseIdent = baseExpr.asKind(SyntaxKind.Identifier);

  if (baseIdent) {
    const obj = resolveToObjectLiteral(baseIdent, checker);
    if (obj) {
      const targetProp = obj.getProperty(propAccess.getName());
      if (targetProp?.getKind() === SyntaxKind.PropertyAssignment) {
        const init = targetProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
        if (init) return evaluateValue(init, checker);
      }
    }
  }

  const value = getExternalEnumValue(propAccess.getExpression().getText(), propAccess.getName());
  if (value !== undefined) return Ok(value);

  return Err(
    createEvaluationError(
      `Cannot resolve property access: ${propAccess.getExpression().getText()}.${propAccess.getName()}`,
      propAccess
    )
  );
};

const BINARY_OPERATORS: Record<number, (l: number, r: number) => number> = {
  [SyntaxKind.BarToken]: (l, r) => l | r,
  [SyntaxKind.AmpersandToken]: (l, r) => l & r,
  [SyntaxKind.CaretToken]: (l, r) => l ^ r,
  [SyntaxKind.LessThanLessThanToken]: (l, r) => l << r,
  [SyntaxKind.GreaterThanGreaterThanToken]: (l, r) => l >> r,
  [SyntaxKind.GreaterThanGreaterThanGreaterThanToken]: (l, r) => l >>> r,
  [SyntaxKind.PlusToken]: (l, r) => l + r,
  [SyntaxKind.MinusToken]: (l, r) => l - r,
  [SyntaxKind.AsteriskToken]: (l, r) => l * r,
  [SyntaxKind.SlashToken]: (l, r) => l / r,
  [SyntaxKind.PercentToken]: (l, r) => l % r,
};

export const evaluateBinaryExpression = (
  node: Node,
  checker: TypeChecker,
  evaluateOperand: (n: Node, c: TypeChecker) => EvaluationResult
): EvaluationResult => {
  if (node.getKind() !== SyntaxKind.BinaryExpression) {
    return Err(createEvaluationError(`Expected BinaryExpression, got ${node.getKindName()}`, node));
  }

  const binExpr = node.asKindOrThrow(SyntaxKind.BinaryExpression);
  const leftResult = evaluateOperand(binExpr.getLeft(), checker);
  const rightResult = evaluateOperand(binExpr.getRight(), checker);

  if (!leftResult.ok) return Err(leftResult.error);
  if (!rightResult.ok) return Err(rightResult.error);

  const left = leftResult.value;
  const right = rightResult.value;

  if (typeof left !== 'number' || typeof right !== 'number') {
    return Err(createEvaluationError('Binary expression operands must be numbers', binExpr));
  }

  const op = BINARY_OPERATORS[binExpr.getOperatorToken().getKind()];
  if (!op)
    return Err(
      createEvaluationError(
        `Unsupported binary operator: ${binExpr.getOperatorToken().getText()}`,
        binExpr
      )
    );

  return Ok(op(left, right));
};

export const isSupportedBinaryExpression = (node: Node): boolean => {
  const binExpr = node.asKind(SyntaxKind.BinaryExpression);
  return binExpr !== undefined && binExpr.getOperatorToken().getKind() in BINARY_OPERATORS;
};

export const evaluate = (node: Node, checker: TypeChecker): EvaluationResult => {
  const kind = node.getKind();

  if (isLiteralNode(node)) return evaluateLiteral(node);

  if (
    kind === SyntaxKind.AsExpression ||
    kind === SyntaxKind.TypeAssertionExpression ||
    kind === SyntaxKind.ParenthesizedExpression
  ) {
    const unwrapped = resolveIdentifierWithFallback(node, checker);
    if (unwrapped) return evaluate(unwrapped, checker);
    return Err(createEvaluationError(`Cannot unwrap node: ${node.getText()}`, node));
  }

  if (kind === SyntaxKind.Identifier) {
    const resolved = resolveIdentifierWithFallback(node, checker);
    if (resolved && resolved !== node) return evaluate(resolved, checker);
    return Err(createEvaluationError(`Cannot resolve identifier: ${node.getText()}`, node));
  }

  if (kind === SyntaxKind.PropertyAccessExpression) {
    return evaluatePropertyAccess(node, checker, evaluate);
  }

  if (isSupportedBinaryExpression(node)) {
    return evaluateBinaryExpression(node, checker, evaluate);
  }

  return Err(createEvaluationError(`Cannot evaluate node of type ${node.getKindName()}`, node));
};

export const tryEvaluate = (
  node: Node,
  checker: TypeChecker
): string | number | boolean | undefined => {
  const result = evaluate(node, checker);
  return result.ok ? result.value : undefined;
};
