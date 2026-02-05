import type { Node, ObjectLiteralExpression, PropertyAssignment } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { iteratePropertyAssignments, getPropertyAssignments } from '../utils/node-helpers.js';

export { getPropertyAssignments as findAllPropertyAssignments };

export function findPropertyAssignment(obj: ObjectLiteralExpression, propName: string): PropertyAssignment | undefined {
  for (const prop of iteratePropertyAssignments(obj)) {
    const name = prop.getNameNode().getText().replace(/['"]/g, '');
    if (name === propName) return prop;
  }
}

export function* findNestedObjectLiterals(node: Node): Generator<ObjectLiteralExpression> {
  if (node.getKind() === SyntaxKind.ObjectLiteralExpression) {
    yield node.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  }
  for (const child of node.getDescendants()) {
    if (child.getKind() === SyntaxKind.ObjectLiteralExpression) {
      yield child.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    }
  }
}
