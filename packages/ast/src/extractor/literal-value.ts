import type {
  ArrayLiteralExpression,
  ArrowFunction,
  BinaryExpression,
  CallExpression,
  Node,
  ObjectLiteralExpression,
  Type,
  TypeChecker,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import type { EnumLiteral } from '../foundation/index.js';
import {
  extractStringLiteralValue,
  getPropertyInitializer,
  getReturnedExpression,
  iteratePropertyAssignments,
  resolveCallExpressionReturn,
  resolveIdentifierInitializerNode,
  resolveValueDeclaration,
  tryEvaluate,
  unwrapNode,
} from '../foundation/index.js';
import type { BoundValue, ParameterBindings } from './bindings.js';
import { bindingsForMapItem, isBoundNode, isLiteralPrimitive } from './bindings.js';

const resolveBoundValue = (
  value: BoundValue,
  checker: TypeChecker,
  bindings?: ParameterBindings
) => (isBoundNode(value) ? extractLiteralValue(value, checker, bindings) : value);

const fallbackOperators = new Set<SyntaxKind>([
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionToken,
]);

const isFallbackOperator = (operator: SyntaxKind) => fallbackOperators.has(operator);

const resolveStaticNode = <T extends Node>(
  node: Node | undefined,
  checker: TypeChecker,
  bindings: ParameterBindings | undefined,
  match: (node: Node) => T | undefined,
  followFallbacks = true
): T | undefined => {
  if (!node) return undefined;

  const unwrapped = unwrapNode(node);
  const direct = match(unwrapped);
  if (direct) return direct;

  const ident = unwrapped.asKind(SyntaxKind.Identifier);
  if (ident && bindings?.has(ident.getText())) {
    const bound = bindings.get(ident.getText());
    return isBoundNode(bound)
      ? resolveStaticNode(bound, checker, bindings, match, followFallbacks)
      : undefined;
  }
  if (ident) {
    return resolveStaticNode(
      resolveIdentifierInitializerNode(ident, checker),
      checker,
      undefined,
      match,
      followFallbacks
    );
  }

  const binExpr = unwrapped.asKind(SyntaxKind.BinaryExpression);
  if (followFallbacks && binExpr && isFallbackOperator(binExpr.getOperatorToken().getKind())) {
    return (
      resolveStaticNode(binExpr.getLeft(), checker, bindings, match, followFallbacks) ??
      resolveStaticNode(binExpr.getRight(), checker, bindings, match, followFallbacks)
    );
  }

  return undefined;
};

const getPropertyValueFromObject = (
  obj: ObjectLiteralExpression,
  propName: string,
  checker: TypeChecker,
  bindings?: ParameterBindings
): unknown => {
  const prop = obj.getProperty(propName)?.asKind(SyntaxKind.PropertyAssignment);
  const init = prop?.getInitializer();
  return init ? extractLiteralValue(init, checker, bindings) : undefined;
};

const extractPropertyAccessValue = (
  node: Node,
  checker: TypeChecker,
  bindings?: ParameterBindings
): unknown => {
  const propAccess = node.asKind(SyntaxKind.PropertyAccessExpression);
  if (!propAccess) return undefined;

  const base = unwrapNode(propAccess.getExpression());
  const baseIdent = base.asKind(SyntaxKind.Identifier);
  const boundBase = baseIdent ? bindings?.get(baseIdent.getText()) : undefined;
  if (isBoundNode(boundBase)) {
    const boundObject = unwrapNode(boundBase).asKind(SyntaxKind.ObjectLiteralExpression);
    if (boundObject) return getPropertyValueFromObject(boundObject, propAccess.getName(), checker);
  }

  const objectLiteral = base.asKind(SyntaxKind.ObjectLiteralExpression);
  if (objectLiteral)
    return getPropertyValueFromObject(objectLiteral, propAccess.getName(), checker);

  const resolvedObject = baseIdent
    ? resolveIdentifierInitializerNode(baseIdent, checker)?.asKind(
        SyntaxKind.ObjectLiteralExpression
      )
    : undefined;
  return resolvedObject
    ? getPropertyValueFromObject(resolvedObject, propAccess.getName(), checker)
    : undefined;
};

export const extractObjectLiteralValue = (
  obj: ObjectLiteralExpression,
  checker: TypeChecker,
  bindings?: ParameterBindings
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const prop of obj.getProperties()) {
    const spread = prop.asKind(SyntaxKind.SpreadAssignment);
    if (spread) {
      const value = extractLiteralValue(spread.getExpression(), checker, bindings);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(result, value);
      }
      continue;
    }

    const propAssignment = prop.asKind(SyntaxKind.PropertyAssignment);
    if (!propAssignment) continue;
    const nameNode = propAssignment.getNameNode();
    const init = propAssignment.getInitializer();
    if (!init) continue;

    const key =
      nameNode.getKind() === SyntaxKind.ComputedPropertyName
        ? extractLiteralValue(
            nameNode.asKindOrThrow(SyntaxKind.ComputedPropertyName).getExpression(),
            checker,
            bindings
          )
        : propAssignment.getName();
    if (!isLiteralPrimitive(key)) continue;

    result[String(key)] = extractLiteralValue(init, checker, bindings);
  }
  return result;
};

const getFunctionReturnExpression = (
  call: CallExpression,
  checker: TypeChecker
): Node | undefined => {
  const ident = call.getExpression().asKind(SyntaxKind.Identifier);
  if (!ident) return undefined;

  const valueDecl = resolveValueDeclaration(ident, checker);
  const functionDecl = valueDecl?.asKind(SyntaxKind.FunctionDeclaration);
  return functionDecl?.getDescendantsOfKind(SyntaxKind.ReturnStatement)[0]?.getExpression();
};

const applyKnownStringMethod = (methodName: string, value: string): string | undefined => {
  switch (methodName) {
    case 'toLowerCase':
      return value.toLowerCase();
    case 'toUpperCase':
      return value.toUpperCase();
    case 'trim':
      return value.trim();
    default:
      return undefined;
  }
};

const extractTemplateExpressionValue = (
  node: Node,
  checker: TypeChecker,
  bindings?: ParameterBindings
): unknown => {
  const call = node.asKind(SyntaxKind.CallExpression);
  const propAccess = call?.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
  if (call && propAccess && call.getArguments().length === 0) {
    const baseValue = extractLiteralValue(propAccess.getExpression(), checker, bindings);
    if (typeof baseValue === 'string') {
      return applyKnownStringMethod(propAccess.getName(), baseValue);
    }
  }

  return extractLiteralValue(node, checker, bindings);
};

const extractTemplateLiteralValue = (
  node: Node,
  checker: TypeChecker,
  bindings?: ParameterBindings
): string | undefined => {
  const noSubstitution = node.asKind(SyntaxKind.NoSubstitutionTemplateLiteral);
  if (noSubstitution) return noSubstitution.getLiteralValue();

  const template = node.asKind(SyntaxKind.TemplateExpression);
  if (!template) return undefined;

  let result = template.getHead().getLiteralText();
  for (const span of template.getTemplateSpans()) {
    const value = extractTemplateExpressionValue(span.getExpression(), checker, bindings);
    if (value === undefined) return undefined;
    result += String(value);
    result += span.getLiteral().getLiteralText();
  }
  return result;
};

const resolveArrayLiteralNode = (
  node: Node | undefined,
  checker: TypeChecker,
  bindings?: ParameterBindings
): ArrayLiteralExpression | undefined =>
  resolveStaticNode(node, checker, bindings, (candidate) =>
    candidate.asKind(SyntaxKind.ArrayLiteralExpression)
  );

const resolveObjectLiteralNode = (
  node: Node | undefined,
  checker: TypeChecker,
  bindings?: ParameterBindings
): ObjectLiteralExpression | undefined =>
  resolveStaticNode(
    node,
    checker,
    bindings,
    (candidate) => candidate.asKind(SyntaxKind.ObjectLiteralExpression),
    false
  );

const extractObjectEntriesMapItems = (
  node: Node,
  checker: TypeChecker,
  bindings?: ParameterBindings
): readonly (BoundValue | readonly BoundValue[])[] | undefined => {
  const objectEntriesCall = node.asKind(SyntaxKind.CallExpression);
  const objectEntriesAccess = objectEntriesCall
    ?.getExpression()
    .asKind(SyntaxKind.PropertyAccessExpression);
  if (
    objectEntriesCall &&
    objectEntriesAccess?.getExpression().getText() === 'Object' &&
    objectEntriesAccess.getName() === 'entries'
  ) {
    const sourceObj = resolveObjectLiteralNode(
      objectEntriesCall.getArguments()[0],
      checker,
      bindings
    );
    if (!sourceObj) return undefined;

    return Array.from(iteratePropertyAssignments(sourceObj))
      .map((prop): readonly BoundValue[] | undefined => {
        const init = prop.getInitializer();
        if (!init) return undefined;
        return [prop.getName(), init] as const;
      })
      .filter((item): item is readonly BoundValue[] => item !== undefined);
  }

  const arraySource = resolveArrayLiteralNode(node, checker, bindings);
  return arraySource?.getElements();
};

const extractObjectFromEntriesValue = (
  call: CallExpression,
  checker: TypeChecker,
  bindings?: ParameterBindings
): Record<string, unknown> | undefined => {
  const propAccess = call.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
  if (
    !propAccess ||
    propAccess.getExpression().getText() !== 'Object' ||
    propAccess.getName() !== 'fromEntries'
  ) {
    return undefined;
  }

  const source = call.getArguments()[0];
  const mapCall = source ? unwrapNode(source).asKind(SyntaxKind.CallExpression) : undefined;
  const mapAccess = mapCall?.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
  if (!mapCall || !mapAccess || mapAccess.getName() !== 'map') return undefined;

  const arrow = mapCall.getArguments()[0]?.asKind(SyntaxKind.ArrowFunction);
  const items = extractObjectEntriesMapItems(mapAccess.getExpression(), checker, bindings);
  if (!arrow || !items) return undefined;

  const result: Record<string, unknown> = {};
  for (const item of items) {
    const itemBindings = bindingsForMapItem(arrow, item);
    const mergedBindings = new Map<string, BoundValue>(bindings);
    for (const [key, value] of itemBindings) mergedBindings.set(key, value);

    const returned = getReturnedExpression(arrow.getBody());
    const tuple = returned?.asKind(SyntaxKind.ArrayLiteralExpression);
    const [keyNode, valueNode] = tuple?.getElements() ?? [];
    if (!keyNode || !valueNode) continue;

    const key = extractLiteralValue(keyNode, checker, mergedBindings);
    if (!isLiteralPrimitive(key)) continue;

    const value = extractLiteralValue(valueNode, checker, mergedBindings);
    if (value !== undefined) result[String(key)] = value;
  }

  return result;
};

export const extractArrayFromStaticSource = (
  node: Node | undefined,
  checker: TypeChecker,
  bindings?: ParameterBindings
): unknown[] | undefined => {
  const arr = resolveArrayLiteralNode(node, checker, bindings);
  if (!arr) return undefined;

  const values = arr
    .getElements()
    .map((element) => extractLiteralValue(element, checker, bindings));
  return values.some((value) => value === undefined) ? undefined : values;
};

const extractFallbackExpressionValue = (
  binExpr: BinaryExpression,
  checker: TypeChecker,
  bindings?: ParameterBindings
): unknown => {
  const op = binExpr.getOperatorToken().getKind();
  if (!isFallbackOperator(op)) return undefined;

  const left = extractLiteralValue(binExpr.getLeft(), checker, bindings);
  if (op === SyntaxKind.QuestionQuestionToken) {
    return left === null || left === undefined
      ? extractLiteralValue(binExpr.getRight(), checker, bindings)
      : left;
  }
  return left ? left : extractLiteralValue(binExpr.getRight(), checker, bindings);
};

const extractKnownStringCallValue = (
  call: CallExpression,
  checker: TypeChecker,
  bindings?: ParameterBindings
): string | undefined => {
  const propAccess = call.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
  if (!propAccess || call.getArguments().length !== 0) return undefined;

  const baseValue = extractLiteralValue(propAccess.getExpression(), checker, bindings);
  return typeof baseValue === 'string'
    ? applyKnownStringMethod(propAccess.getName(), baseValue)
    : undefined;
};

const extractCallExpressionValue = (
  call: CallExpression,
  checker: TypeChecker,
  bindings?: ParameterBindings
): unknown => {
  const propAccess = call.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
  if (propAccess?.getExpression().getText() === 'JSON' && propAccess.getName() === 'stringify') {
    const value = extractLiteralValue(call.getArguments()[0], checker, bindings);
    return value === undefined ? undefined : JSON.stringify(value);
  }

  const stringMethodResult = extractKnownStringCallValue(call, checker, bindings);
  if (stringMethodResult !== undefined) return stringMethodResult;

  if (call.getExpression().getText() === 'Array.from') {
    const value = extractArrayFromStaticSource(call.getArguments()[0], checker, bindings);
    if (value !== undefined) return value;
  }

  if (
    propAccess?.getExpression().getText() === 'Object' &&
    propAccess.getName() === 'fromEntries'
  ) {
    const value = extractObjectFromEntriesValue(call, checker, bindings);
    if (value !== undefined) return value;
  }

  const returned =
    resolveCallExpressionReturn(call, checker) ?? getFunctionReturnExpression(call, checker);
  return returned ? extractLiteralValue(returned, checker, bindings) : undefined;
};

export const extractLiteralValue = (
  node: Node | undefined,
  checker: TypeChecker,
  bindings?: ParameterBindings
): unknown => {
  if (!node) return undefined;

  const unwrapped = unwrapNode(node);
  if (unwrapped !== node) return extractLiteralValue(unwrapped, checker, bindings);

  if (unwrapped.getKind() === SyntaxKind.UndefinedKeyword) return undefined;

  const ident = unwrapped.asKind(SyntaxKind.Identifier);
  if (ident && bindings?.has(ident.getText())) {
    return resolveBoundValue(bindings.get(ident.getText()), checker, bindings);
  }
  if (ident) {
    const init = resolveIdentifierInitializerNode(ident, checker);
    if (init && init !== ident) return extractLiteralValue(init, checker, bindings);
  }

  const kind = unwrapped.getKind();
  if (kind === SyntaxKind.BigIntLiteral) {
    const raw = unwrapped.asKindOrThrow(SyntaxKind.BigIntLiteral).getText();
    return raw.toLowerCase().endsWith('n') ? raw.slice(0, -1) : raw;
  }
  if (kind === SyntaxKind.ObjectLiteralExpression) {
    return extractObjectLiteralValue(
      unwrapped.asKindOrThrow(SyntaxKind.ObjectLiteralExpression),
      checker,
      bindings
    );
  }
  if (kind === SyntaxKind.ArrayLiteralExpression) {
    const arr = unwrapped.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
    return arr.getElements().map((el) => extractLiteralValue(el, checker, bindings));
  }
  if (kind === SyntaxKind.NoSubstitutionTemplateLiteral || kind === SyntaxKind.TemplateExpression) {
    return extractTemplateLiteralValue(unwrapped, checker, bindings);
  }
  if (kind === SyntaxKind.PropertyAccessExpression) {
    const value = extractPropertyAccessValue(unwrapped, checker, bindings);
    if (value !== undefined) return value;
  }
  if (kind === SyntaxKind.BinaryExpression) {
    return extractFallbackExpressionValue(
      unwrapped.asKindOrThrow(SyntaxKind.BinaryExpression),
      checker,
      bindings
    );
  }
  if (kind === SyntaxKind.CallExpression) {
    const value = extractCallExpressionValue(
      unwrapped.asKindOrThrow(SyntaxKind.CallExpression),
      checker,
      bindings
    );
    if (value !== undefined) return value;
  }
  return tryEvaluate(unwrapped, checker);
};

const extractLiteralFromTypeNode = (node: Node): EnumLiteral | undefined => {
  const literalNode = node.asKind(SyntaxKind.LiteralType)?.getLiteral();
  if (!literalNode) return undefined;
  if (literalNode.getKind() === SyntaxKind.StringLiteral) {
    return literalNode.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();
  }
  if (literalNode.getKind() === SyntaxKind.NumericLiteral) {
    return literalNode.asKindOrThrow(SyntaxKind.NumericLiteral).getLiteralValue();
  }
  if (literalNode.getKind() === SyntaxKind.TrueKeyword) return true;
  if (literalNode.getKind() === SyntaxKind.FalseKeyword) return false;
  return undefined;
};

const extractLiteralUnionFromTypeNode = (node: Node): readonly EnumLiteral[] | undefined => {
  const unionNode = node.asKind(SyntaxKind.UnionType);
  if (unionNode) {
    const values = unionNode.getTypeNodes().map(extractLiteralFromTypeNode);
    return values.every((value): value is EnumLiteral => value !== undefined)
      ? Object.freeze(values)
      : undefined;
  }

  const typeRef = node.asKind(SyntaxKind.TypeReference);
  const typeName = typeRef?.getTypeName();
  if (typeName) {
    const symbol = typeName.getSymbol();
    const aliasedSymbol = symbol?.getAliasedSymbol();
    const declaration = aliasedSymbol?.getDeclarations()[0] ?? symbol?.getDeclarations()[0];
    const aliasTypeNode = declaration?.asKind(SyntaxKind.TypeAliasDeclaration)?.getTypeNode();
    return aliasTypeNode ? extractLiteralUnionFromTypeNode(aliasTypeNode) : undefined;
  }

  return undefined;
};

export const extractLiteralUnionFromTypes = (
  unionTypes: readonly Type[],
  textNode: Node
): readonly EnumLiteral[] | undefined => {
  if (unionTypes.length === 0) return undefined;

  const values = unionTypes
    .map((unionType) => {
      if (unionType.isStringLiteral() || unionType.isNumberLiteral()) {
        return unionType.getLiteralValue();
      }
      if (unionType.isBooleanLiteral()) {
        const text = unionType.getText(textNode);
        if (text === 'true') return true;
        if (text === 'false') return false;
      }
      return undefined;
    })
    .filter(isLiteralPrimitive);

  return values.length === unionTypes.length ? Object.freeze(values) : undefined;
};

export const extractLiteralUnionValues = (
  node: Node | undefined,
  checker: TypeChecker
): readonly EnumLiteral[] | undefined => {
  if (!node) return undefined;
  const typeNode = node.asKind(SyntaxKind.AsExpression)?.getTypeNode();
  if (!typeNode) return undefined;

  const staticValues = extractLiteralUnionFromTypeNode(typeNode);
  if (staticValues) return staticValues;

  try {
    const type = checker.getTypeAtLocation(typeNode);
    const unionTypes = type.getUnionTypes();
    const values = extractLiteralUnionFromTypes(unionTypes, typeNode);
    if (values) return values;
  } catch {}

  try {
    const type = checker.getTypeAtLocation(node);
    const unionTypes = type.getUnionTypes();
    return extractLiteralUnionFromTypes(unionTypes, node);
  } catch {
    return undefined;
  }
};

export const extractStringPropertyValue = (
  valueObj: ObjectLiteralExpression,
  propName: string,
  checker: TypeChecker,
  bindings?: ParameterBindings
): string | undefined => {
  const literalValue = extractStringLiteralValue(valueObj, propName);
  if (literalValue !== undefined) return literalValue;

  const init = getPropertyInitializer(valueObj, propName);
  const evaluatedValue = init ? extractLiteralValue(init, checker, bindings) : undefined;
  if (typeof evaluatedValue === 'string') return evaluatedValue;

  const shorthand = valueObj.getProperty(propName)?.asKind(SyntaxKind.ShorthandPropertyAssignment);
  const shorthandValue = resolveBoundValue(
    bindings?.get(shorthand?.getName() ?? ''),
    checker,
    bindings
  );
  if (typeof shorthandValue === 'string') return shorthandValue;

  const ident = init?.asKind(SyntaxKind.Identifier);
  if (!ident) return undefined;

  const boundValue = resolveBoundValue(bindings?.get(ident.getText()), checker, bindings);
  return typeof boundValue === 'string' ? boundValue : undefined;
};

export const extractSettingKey = (
  node: Node | undefined,
  checker: TypeChecker,
  bindings: ParameterBindings
): string | undefined => {
  const value = extractLiteralValue(node, checker, bindings);
  return isLiteralPrimitive(value) ? String(value) : undefined;
};
