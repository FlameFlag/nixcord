import { Err, Ok, unwrapOrUndefined } from '@nixcord/shared';
import type { Node, TypeChecker } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { isLiteralNode } from './predicates.js';
import { resolveIdentifierWithFallback, resolveToObjectLiteral } from './resolve.js';
import type { EvaluationResult } from './types.js';
import { createEvaluationError } from './types.js';
import { unwrapNode } from './unwrap.js';

const evaluateLiteral = (node: Node): EvaluationResult => {
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

const EXTERNAL_ENUMS: Record<string, Record<string, number>> = {
  ActivityType: { PLAYING: 0, STREAMING: 1, LISTENING: 2, WATCHING: 3, CUSTOM: 4, COMPETING: 5 },
  StatusType: { ONLINE: 0, IDLE: 1, DND: 2, INVISIBLE: 3 },
  ChannelType: { GUILD_TEXT: 0, DM: 1, GUILD_VOICE: 2 },
};

const getExternalEnumValue = (enumName: string, member: string): number | undefined =>
  EXTERNAL_ENUMS[enumName]?.[member];

const evaluatePropertyAccess = (
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

const evaluateBinaryExpression = (
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

const isSupportedBinaryExpression = (node: Node): boolean => {
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
    const unwrapped = unwrapNode(node);
    if (unwrapped !== node) return evaluate(unwrapped, checker);
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
): string | number | boolean | undefined => unwrapOrUndefined(evaluate(node, checker));
