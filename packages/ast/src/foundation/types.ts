import type { Result } from '@nixcord/shared';
import type { Node } from 'ts-morph';

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
