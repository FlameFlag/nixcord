import type { ArrowFunction, Node } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import type { EnumLiteral } from '../foundation/index.js';

export type BoundValue = Node | EnumLiteral | undefined;
export type ParameterBindings = ReadonlyMap<string, BoundValue>;

export const isBoundNode = (value: BoundValue): value is Node =>
  typeof value === 'object' && value !== null && typeof (value as Node).getKind === 'function';

export const isLiteralPrimitive = (value: unknown): value is EnumLiteral =>
  ['string', 'number', 'boolean'].includes(typeof value);

const bindParameter = (
  bindings: Map<string, BoundValue>,
  parameterNode: Node,
  value: BoundValue | readonly BoundValue[]
) => {
  const nameNode = parameterNode.asKind(SyntaxKind.Parameter)?.getNameNode() ?? parameterNode;
  const ident = nameNode.asKind(SyntaxKind.Identifier);
  if (ident && !Array.isArray(value)) {
    bindings.set(ident.getText(), value as BoundValue);
    return;
  }

  const arrayPattern = nameNode.asKind(SyntaxKind.ArrayBindingPattern);
  if (!arrayPattern || !Array.isArray(value)) return;

  for (const [index, element] of arrayPattern.getElements().entries()) {
    const elementNameNode = element.asKind(SyntaxKind.BindingElement)?.getNameNode();
    if (!elementNameNode) continue;
    bindParameter(bindings, elementNameNode, value[index]);
  }
};

export const bindObjectPatternProperties = (
  bindings: Map<string, BoundValue>,
  parameterNode: Node,
  values: ReadonlyMap<string, BoundValue>
) => {
  const objectPattern = parameterNode.asKind(SyntaxKind.ObjectBindingPattern);
  if (!objectPattern) return;

  for (const element of objectPattern.getElements()) {
    const nameNode = element.getNameNode();
    const propertyNameNode = element.getPropertyNameNode();
    const sourceName = propertyNameNode?.getText() ?? nameNode.getText();
    const sourceValue = values.get(sourceName);
    if (sourceValue === undefined) continue;
    bindParameter(bindings, nameNode, sourceValue);
  }
};

export const bindingsForMapItem = (
  arrow: ArrowFunction,
  item: BoundValue | readonly BoundValue[]
): ParameterBindings => {
  const bindings = new Map<string, BoundValue>();
  for (const [index, parameter] of arrow.getParameters().entries()) {
    if (index > 0) continue;
    bindParameter(bindings, parameter.getNameNode(), item);
  }
  return bindings;
};

export const bindingsForCallParameters = (
  parameters: readonly Node[],
  args: readonly Node[],
  outerBindings?: ParameterBindings
): ParameterBindings => {
  const bindings = new Map<string, BoundValue>(outerBindings);
  for (const [index, parameter] of parameters.entries()) {
    const arg = args[index];
    if (!arg) continue;
    bindParameter(bindings, parameter, arg);
  }
  return bindings;
};
