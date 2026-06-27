import type { CallExpression, Node, ObjectLiteralExpression, TypeChecker } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import {
  getPropertyInitializer,
  resolveValueDeclaration,
  unwrapNode,
} from '../foundation/index.js';
import type { ParameterBindings } from './bindings.js';
import {
  type BoundValue,
  bindingsForCallParameters,
  bindObjectPatternProperties,
  isBoundNode,
  isLiteralPrimitive,
} from './bindings.js';
import { COMPONENT_PROPERTY } from './constants.js';
import { extractArrayFromStaticSource, extractLiteralValue } from './literal-value.js';

export type ComponentSearchTarget = {
  node: Node;
  bindings?: ParameterBindings;
};

const getCallableDeclarationForCall = (
  call: CallExpression,
  checker: TypeChecker
): Node | undefined => {
  const ident = call.getExpression().asKind(SyntaxKind.Identifier);
  if (!ident) return undefined;

  return resolveValueDeclaration(ident, checker);
};

const getReturnExpressionFromCallableDeclaration = (
  declaration: Node | undefined
): Node | undefined => {
  const functionDecl = declaration?.asKind(SyntaxKind.FunctionDeclaration);
  if (functionDecl)
    return functionDecl
      .getBody()
      ?.asKind(SyntaxKind.Block)
      ?.getStatements()
      .find((statement) => statement.getKind() === SyntaxKind.ReturnStatement)
      ?.asKind(SyntaxKind.ReturnStatement)
      ?.getExpression();

  const arrow = declaration
    ?.asKind(SyntaxKind.VariableDeclaration)
    ?.getInitializer()
    ?.asKind(SyntaxKind.ArrowFunction);
  if (!arrow) return undefined;

  const body = unwrapNode(arrow.getBody());
  const block = body.asKind(SyntaxKind.Block);
  return block ? block.getDescendantsOfKind(SyntaxKind.ReturnStatement)[0]?.getExpression() : body;
};

const createBindingsForCallableDeclaration = (
  declaration: Node | undefined,
  args: readonly Node[],
  outerBindings?: ParameterBindings
): ParameterBindings | undefined => {
  const functionDecl = declaration?.asKind(SyntaxKind.FunctionDeclaration);
  if (functionDecl)
    return bindingsForCallParameters(functionDecl.getParameters(), args, outerBindings);

  const arrow = declaration
    ?.asKind(SyntaxKind.VariableDeclaration)
    ?.getInitializer()
    ?.asKind(SyntaxKind.ArrowFunction);
  if (!arrow) return outerBindings;

  return bindingsForCallParameters(arrow.getParameters(), args, outerBindings);
};

const resolveComponentIdentifierTargets = (
  ident: Node,
  checker: TypeChecker,
  bindings?: ParameterBindings,
  visited = new Set<string>()
): ComponentSearchTarget[] => {
  const valueDecl = resolveValueDeclaration(ident, checker);
  if (!valueDecl) return [];

  const visitedKey = `${valueDecl.getSourceFile().getFilePath()}:${valueDecl.getStart()}`;
  if (visited.has(visitedKey)) return [];
  visited.add(visitedKey);

  const functionDecl = valueDecl.asKind(SyntaxKind.FunctionDeclaration);
  if (functionDecl) return [{ node: functionDecl.getBody() ?? functionDecl, bindings }];

  const init = valueDecl.asKind(SyntaxKind.VariableDeclaration)?.getInitializer();
  return init ? resolveComponentSearchTargets(init, checker, bindings, visited) : [];
};

const resolveComponentSearchTargets = (
  init: Node | undefined,
  checker: TypeChecker,
  bindings?: ParameterBindings,
  visited = new Set<string>()
): ComponentSearchTarget[] => {
  if (!init) return [];
  const unwrapped = unwrapNode(init);

  const arrow = unwrapped.asKind(SyntaxKind.ArrowFunction);
  if (arrow) return [{ node: arrow.getBody(), bindings }];

  const functionExpression = unwrapped.asKind(SyntaxKind.FunctionExpression);
  if (functionExpression) return [{ node: functionExpression.getBody(), bindings }];

  const ident = unwrapped.asKind(SyntaxKind.Identifier);
  if (ident) return resolveComponentIdentifierTargets(ident, checker, bindings, visited);

  const call = unwrapped.asKind(SyntaxKind.CallExpression);
  if (!call) return [];

  const targets = call
    .getArguments()
    .flatMap((arg) => resolveComponentSearchTargets(arg, checker, bindings, visited));

  const callableDecl = getCallableDeclarationForCall(call, checker);
  const returned = getReturnExpressionFromCallableDeclaration(callableDecl);
  if (returned) {
    targets.push(
      ...resolveComponentSearchTargets(
        returned,
        checker,
        createBindingsForCallableDeclaration(callableDecl, call.getArguments(), bindings),
        visited
      )
    );
  }

  return targets;
};

const resolveJsxAttributeValue = (attr: Node, bindings?: ParameterBindings): BoundValue => {
  const jsxAttr = attr.asKind(SyntaxKind.JsxAttribute);
  const init = jsxAttr?.getInitializer();
  if (!init) return true;

  const stringLiteral = init.asKind(SyntaxKind.StringLiteral);
  if (stringLiteral) return stringLiteral.getLiteralValue();

  const expr = init.asKind(SyntaxKind.JsxExpression)?.getExpression();
  if (!expr) return undefined;

  const exprLiteral = expr.asKind(SyntaxKind.StringLiteral);
  if (exprLiteral) return exprLiteral.getLiteralValue();

  const templateLiteral = expr.asKind(SyntaxKind.NoSubstitutionTemplateLiteral);
  if (templateLiteral) return templateLiteral.getLiteralValue();

  if (expr.getKind() === SyntaxKind.TrueKeyword) return true;
  if (expr.getKind() === SyntaxKind.FalseKeyword) return false;

  const ident = expr.asKind(SyntaxKind.Identifier);
  const bound = ident ? bindings?.get(ident.getText()) : undefined;
  if (isLiteralPrimitive(bound)) return bound;
  if (isBoundNode(bound)) {
    const boundString = unwrapNode(bound).asKind(SyntaxKind.StringLiteral);
    if (boundString) return boundString.getLiteralValue();
    const boundTemplate = unwrapNode(bound).asKind(SyntaxKind.NoSubstitutionTemplateLiteral);
    if (boundTemplate) return boundTemplate.getLiteralValue();
    if (bound.getKind() === SyntaxKind.TrueKeyword) return true;
    if (bound.getKind() === SyntaxKind.FalseKeyword) return false;
  }

  return expr;
};

const getJsxTagIdentifier = (node: Node): Node | undefined => {
  const selfClosing = node.asKind(SyntaxKind.JsxSelfClosingElement);
  const opening = node.asKind(SyntaxKind.JsxOpeningElement);
  const tagName = selfClosing?.getTagNameNode() ?? opening?.getTagNameNode();
  const ident = tagName?.asKind(SyntaxKind.Identifier);
  if (!ident) return undefined;
  return /^[A-Z]/.test(ident.getText()) ? ident : undefined;
};

const buildJsxPropBindings = (
  jsxNode: Node,
  checker: TypeChecker,
  target: Node,
  parentBindings?: ParameterBindings
): ParameterBindings | undefined => {
  const attrs =
    jsxNode.asKind(SyntaxKind.JsxSelfClosingElement)?.getAttributes() ??
    jsxNode.asKind(SyntaxKind.JsxOpeningElement)?.getAttributes() ??
    [];
  const attrValues = new Map<string, BoundValue>();
  for (const attr of attrs) {
    const jsxAttr = attr.asKind(SyntaxKind.JsxAttribute);
    if (!jsxAttr) continue;
    attrValues.set(jsxAttr.getNameNode().getText(), resolveJsxAttributeValue(attr, parentBindings));
  }

  const symbol = target.getSymbol() ?? checker.getSymbolAtLocation(target);
  const valueDecl =
    symbol?.getValueDeclaration() ?? symbol?.getAliasedSymbol()?.getValueDeclaration?.();
  const functionDecl = valueDecl?.asKind(SyntaxKind.FunctionDeclaration);
  const arrow = valueDecl
    ?.asKind(SyntaxKind.VariableDeclaration)
    ?.getInitializer()
    ?.asKind(SyntaxKind.ArrowFunction);
  const firstParam = (functionDecl ?? arrow)?.getParameters()[0]?.getNameNode();
  if (!firstParam) return parentBindings;

  const bindings = new Map<string, BoundValue>(parentBindings);
  bindObjectPatternProperties(bindings, firstParam, attrValues);
  return bindings;
};

const componentExpressionMentionsKey = (
  node: Node | undefined,
  key: string,
  checker: TypeChecker,
  visited = new Set<string>()
): boolean => {
  if (!node) return false;
  const unwrapped = unwrapNode(node);

  const stringLiteral = unwrapped.asKind(SyntaxKind.StringLiteral);
  if (stringLiteral?.getLiteralValue() === key) return true;
  const templateLiteral = unwrapped.asKind(SyntaxKind.NoSubstitutionTemplateLiteral);
  if (templateLiteral?.getLiteralValue() === key) return true;

  const ident = unwrapped.asKind(SyntaxKind.Identifier);
  if (ident) {
    const valueDecl = resolveValueDeclaration(ident, checker);
    const visitedKey = valueDecl
      ? `${valueDecl.getSourceFile().getFilePath()}:${valueDecl.getStart()}`
      : undefined;
    if (!valueDecl || !visitedKey || visited.has(visitedKey)) return false;
    visited.add(visitedKey);
    return componentExpressionMentionsKey(
      valueDecl.asKind(SyntaxKind.VariableDeclaration)?.getInitializer(),
      key,
      checker,
      visited
    );
  }

  const call = unwrapped.asKind(SyntaxKind.CallExpression);
  if (!call) return false;
  return call
    .getArguments()
    .some((arg) => componentExpressionMentionsKey(arg, key, checker, visited));
};

export const nodeReferencesSettingsStoreKey = (
  node: Node | undefined,
  key: string,
  checker?: TypeChecker,
  bindings?: ParameterBindings
): boolean => {
  if (!node) return false;

  const matches = (candidate: Node): boolean => {
    const propAccess = candidate.asKind(SyntaxKind.PropertyAccessExpression);
    if (propAccess?.getName() === key && propAccess.getExpression().getText() === 'settings.store')
      return true;

    const elementAccess = candidate.asKind(SyntaxKind.ElementAccessExpression);
    if (elementAccess?.getExpression().getText() !== 'settings.store') return false;
    const arg = elementAccess.getArgumentExpression();
    if (!arg) return false;
    if (!checker) return arg.asKind(SyntaxKind.StringLiteral)?.getLiteralValue() === key;
    return extractLiteralValue(arg, checker, bindings) === key;
  };

  return matches(node) || node.getDescendants().some(matches);
};

export const collectComponentSearchTargets = (
  init: Node | undefined,
  checker: TypeChecker
): ComponentSearchTarget[] => {
  const roots = resolveComponentSearchTargets(init, checker);
  const targets: ComponentSearchTarget[] = [...roots];
  const seen = new Set<string>();

  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    const key = `${target.node.getSourceFile().getFilePath()}:${target.node.getStart()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const jsxNodes = [
      ...target.node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
      ...target.node.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ];
    for (const jsxNode of jsxNodes) {
      const ident = getJsxTagIdentifier(jsxNode);
      if (!ident) continue;
      const childBindings = buildJsxPropBindings(jsxNode, checker, ident, target.bindings);
      targets.push(...resolveComponentSearchTargets(ident, checker, childBindings));
    }
  }

  return targets;
};

const componentSearchTargetReferencesKey = (
  target: ComponentSearchTarget,
  key: string,
  checker: TypeChecker
): boolean => {
  if (nodeReferencesSettingsStoreKey(target.node, key, checker, target.bindings)) return true;

  return target.node.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    const propAccess = call.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
    if (!propAccess || propAccess.getExpression().getText() !== 'settings') return false;
    if (propAccess.getName() !== 'use') return false;

    const keys = extractArrayFromStaticSource(call.getArguments()[0], checker, target.bindings);
    return keys?.includes(key) ?? false;
  });
};

export const componentReferencesSettingsKey = (
  valueObj: ObjectLiteralExpression,
  key: string,
  checker: TypeChecker
): boolean => {
  const componentInit = getPropertyInitializer(valueObj, COMPONENT_PROPERTY);
  const targets = collectComponentSearchTargets(componentInit, checker);
  return (
    targets.some((target) => componentSearchTargetReferencesKey(target, key, checker)) ||
    componentExpressionMentionsKey(componentInit, key, checker)
  );
};

export const collectComponentStoreAliases = (
  searchNode: Node,
  key: string,
  checker: TypeChecker,
  bindings?: ParameterBindings
): Set<string> => {
  const aliases = new Set<string>();

  for (const decl of searchNode.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (!nodeReferencesSettingsStoreKey(init, key, checker, bindings)) continue;
    aliases.add(decl.getName());
  }

  return aliases;
};
