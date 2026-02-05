import type {
  Node,
  TypeChecker,
  Identifier,
  VariableDeclaration,
  PropertyAccessExpression,
  BinaryExpression,
  StringLiteral,
  NumericLiteral,
  NoSubstitutionTemplateLiteral,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { Maybe, Result } from 'true-myth';

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
  const kind = node.getKind();
  if (kind === SyntaxKind.AsExpression) {
    return unwrapNode((node as unknown as { getExpression(): Node }).getExpression() as T);
  }
  if (kind === SyntaxKind.TypeAssertionExpression) {
    return unwrapNode((node as unknown as { getExpression(): Node }).getExpression() as T);
  }
  if (kind === SyntaxKind.ParenthesizedExpression) {
    return unwrapNode((node as unknown as { getExpression(): Node }).getExpression() as T);
  }
  return node;
};

export const isWrappedNode = (node: Node): boolean =>
  node.getKind() === SyntaxKind.AsExpression ||
  node.getKind() === SyntaxKind.TypeAssertionExpression ||
  node.getKind() === SyntaxKind.ParenthesizedExpression;

export const getArrowFunctionBody = (node: Node): Maybe<Node> => {
  if (node.getKind() !== SyntaxKind.ArrowFunction) return Maybe.nothing();
  const body = (node as unknown as { getBody(): Node }).getBody();
  return body ? Maybe.just(unwrapNode(body)) : Maybe.nothing();
};

export const evaluateLiteral = (node: Node): EvaluationResult => {
  const unwrapped = unwrapNode(node);
  const kind = unwrapped.getKind();

  if (kind === SyntaxKind.StringLiteral) {
    return Result.ok((unwrapped as unknown as StringLiteral).getLiteralValue());
  }
  if (kind === SyntaxKind.NumericLiteral) {
    return Result.ok((unwrapped as unknown as NumericLiteral).getLiteralValue());
  }
  if (kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return Result.ok((unwrapped as unknown as NoSubstitutionTemplateLiteral).getLiteralValue());
  }
  if (kind === SyntaxKind.TrueKeyword) return Result.ok(true);
  if (kind === SyntaxKind.FalseKeyword) return Result.ok(false);

  return Result.err(
    createEvaluationError(`Expected literal value, got ${unwrapped.getKindName()}`, unwrapped)
  );
};

export const isLiteralNode = (node: Node): boolean => isLiteralKind(unwrapNode(node).getKind());

export const resolveIdentifier = (identifier: Identifier, checker: TypeChecker): Maybe<Node> => {
  const symbol = identifier.getSymbol() ?? checker.getSymbolAtLocation(identifier);
  if (!symbol) return Maybe.nothing();

  const valueDecl = symbol.getValueDeclaration();
  if (!valueDecl) return Maybe.nothing();

  if (valueDecl.getKind() === SyntaxKind.VariableDeclaration) {
    const init = (valueDecl as unknown as VariableDeclaration).getInitializer();
    return init ? Maybe.just(unwrapNode(init)) : Maybe.nothing();
  }
  return Maybe.nothing();
};

export const resolveIdentifierNode = (node: Node, checker: TypeChecker): Node => {
  if (node.getKind() !== SyntaxKind.Identifier) return node;
  const resolved = resolveIdentifier(node as unknown as Identifier, checker);
  return resolved.isJust ? resolved.value : node;
};

export const resolveIdentifierWithFallback = (
  node: Node,
  checker: TypeChecker
): Node | undefined => {
  if (node.getKind() !== SyntaxKind.Identifier) return undefined;
  const identifier = node as unknown as Identifier;
  const resolved = resolveIdentifier(identifier, checker);
  if (resolved.isJust) return resolved.value;

  const decl = identifier.getSourceFile().getVariableDeclaration(identifier.getText());
  const init = decl?.getInitializer();
  return init ? unwrapNode(init) : undefined;
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
    return Result.err(
      createEvaluationError(`Expected PropertyAccessExpression, got ${node.getKindName()}`, node)
    );
  }

  const propAccess = node as unknown as PropertyAccessExpression;
  const symbol = propAccess.getSymbol() ?? checker.getSymbolAtLocation(propAccess);
  const valueDecl = symbol?.getValueDeclaration();

  const enumMember = valueDecl?.asKind(SyntaxKind.EnumMember);
  if (enumMember) {
    const value = (enumMember as unknown as { getValue?: () => unknown }).getValue?.();
    if (typeof value === 'number' || typeof value === 'string') return Result.ok(value);

    const init = enumMember.getInitializer();
    if (init) return evaluateValue(init, checker);
  }

  const baseExpr = propAccess.getExpression();
  const baseIdent = baseExpr.asKind(SyntaxKind.Identifier);

  if (baseIdent) {
    const baseSym = baseIdent.getSymbol() ?? checker.getSymbolAtLocation(baseIdent);
    let baseDecl = baseSym?.getValueDeclaration();

    try {
      if (!baseDecl && (baseSym as any)?.getAliasedSymbol) {
        baseDecl = (baseSym as any).getAliasedSymbol()?.getValueDeclaration?.();
      }
    } catch {}

    let baseInit =
      baseDecl && 'getInitializer' in baseDecl ? (baseDecl as any).getInitializer?.() : undefined;

    if (baseInit?.getKind() === SyntaxKind.AsExpression) {
      baseInit = baseInit.asKindOrThrow(SyntaxKind.AsExpression).getExpression();
    }

    const obj = baseInit?.asKind(SyntaxKind.ObjectLiteralExpression);
    if (obj) {
      const targetProp = obj.getProperty(propAccess.getName());
      if (targetProp?.getKind() === SyntaxKind.PropertyAssignment) {
        const init = targetProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
        if (init) return evaluateValue(init, checker);
      }
    }

    if (!baseInit) {
      const decl = baseIdent.getSourceFile().getVariableDeclaration(baseIdent.getText());
      let altInit = decl?.getInitializer();
      if (altInit?.getKind() === SyntaxKind.AsExpression) {
        altInit = altInit.asKindOrThrow(SyntaxKind.AsExpression).getExpression();
      }
      const altObj = altInit?.asKind(SyntaxKind.ObjectLiteralExpression);
      if (altObj) {
        const targetProp = altObj.getProperty(propAccess.getName());
        if (targetProp?.getKind() === SyntaxKind.PropertyAssignment) {
          const init = targetProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
          if (init) return evaluateValue(init, checker);
        }
      }
    }
  }

  const value = getExternalEnumValue(propAccess.getExpression().getText(), propAccess.getName());
  if (value !== undefined) return Result.ok(value);

  return Result.err(
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
    return Result.err(
      createEvaluationError(`Expected BinaryExpression, got ${node.getKindName()}`, node)
    );
  }

  const binExpr = node as unknown as BinaryExpression;
  const leftResult = evaluateOperand(binExpr.getLeft(), checker);
  const rightResult = evaluateOperand(binExpr.getRight(), checker);

  if (leftResult.isErr) return Result.err(leftResult.error);
  if (rightResult.isErr) return Result.err(rightResult.error);

  const left = leftResult.value;
  const right = rightResult.value;

  if (typeof left !== 'number' || typeof right !== 'number') {
    return Result.err(createEvaluationError('Binary expression operands must be numbers', binExpr));
  }

  const op = BINARY_OPERATORS[binExpr.getOperatorToken().getKind()];
  if (!op)
    return Result.err(
      createEvaluationError(
        `Unsupported binary operator: ${binExpr.getOperatorToken().getText()}`,
        binExpr
      )
    );

  return Result.ok(op(left, right));
};

export const isSupportedBinaryExpression = (node: Node): boolean =>
  node.getKind() === SyntaxKind.BinaryExpression &&
  (node as unknown as BinaryExpression).getOperatorToken().getKind() in BINARY_OPERATORS;

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
    return Result.err(createEvaluationError(`Cannot unwrap node: ${node.getText()}`, node));
  }

  if (kind === SyntaxKind.Identifier) {
    const resolved = resolveIdentifierWithFallback(node, checker);
    if (resolved && resolved !== node) return evaluate(resolved, checker);
    return Result.err(createEvaluationError(`Cannot resolve identifier: ${node.getText()}`, node));
  }

  if (kind === SyntaxKind.PropertyAccessExpression) {
    return evaluatePropertyAccess(node, checker, evaluate);
  }

  if (isSupportedBinaryExpression(node)) {
    return evaluateBinaryExpression(node, checker, evaluate);
  }

  return Result.err(
    createEvaluationError(`Cannot evaluate node of type ${node.getKindName()}`, node)
  );
};

export const tryEvaluate = (
  node: Node,
  checker: TypeChecker
): string | number | boolean | undefined => {
  const result = evaluate(node, checker);
  return result.isOk ? result.value : undefined;
};
