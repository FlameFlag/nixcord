import type { PluginConfig, PluginSetting } from '@nixcord/shared';
import type { CallExpression, Node, ObjectLiteralExpression, TypeChecker } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import { getPropertyInitializer, unwrapNode } from '../foundation/index.js';
import type { ParameterBindings } from './bindings.js';
import { bindingsForMapItem } from './bindings.js';
import {
  collectComponentSearchTargets,
  collectComponentStoreAliases,
  componentReferencesSettingsKey,
  nodeReferencesSettingsStoreKey,
} from './component-search.js';
import { COMPONENT_PROPERTY, NIX_TYPE_NULL_OR_STR } from './constants.js';
import { isBareComponentSetting } from './default-value-resolution.js';
import {
  extractLiteralValue,
  extractObjectLiteralValue,
  extractSettingKey,
} from './literal-value.js';
import {
  buildPluginSetting,
  extractProperties,
  inferSettingTypeFromDefault,
  resolveArrayLiteral,
} from './setting-shape.js';

type ComponentStructuredDefault = {
  key: string;
  description?: string;
  defaults: Record<string, unknown>;
};

const leftTargetsStoreBackedSetting = (
  left: Node,
  key: string,
  storeAliases: ReadonlySet<string>,
  checker: TypeChecker,
  bindings?: ParameterBindings
): boolean => {
  const elementAccess = unwrapNode(left).asKind(SyntaxKind.ElementAccessExpression);
  if (!elementAccess) return false;

  const target = unwrapNode(elementAccess.getExpression());
  const targetIdent = target.asKind(SyntaxKind.Identifier);
  if (targetIdent && storeAliases.has(targetIdent.getText())) return true;

  return nodeReferencesSettingsStoreKey(target, key, checker, bindings);
};

const describeStructuredComponentChild = (
  childKey: string,
  parentDescription: string | undefined
): string | undefined => {
  if (!parentDescription) return undefined;

  switch (childKey) {
    case 'text':
      return `Text for ${parentDescription}`;
    case 'showInChat':
      return `Show ${parentDescription} in messages`;
    case 'showInNotChat':
      return `Show ${parentDescription} in member list and profiles`;
    default:
      return undefined;
  }
};

const buildStructuredComponentConfig = (
  key: string,
  structuredDefaults: readonly ComponentStructuredDefault[]
): PluginConfig | undefined => {
  if (structuredDefaults.length === 0) return undefined;

  const settings: Record<string, PluginConfig> = {};
  for (const entry of structuredDefaults) {
    const childSettings: Record<string, PluginSetting> = {};
    for (const [childKey, defaultValue] of Object.entries(entry.defaults)) {
      childSettings[childKey] = buildPluginSetting(
        childKey,
        inferSettingTypeFromDefault(defaultValue),
        describeStructuredComponentChild(childKey, entry.description),
        defaultValue,
        undefined,
        undefined,
        undefined,
        false,
        false
      );
    }

    if (Object.keys(childSettings).length === 0) continue;
    settings[entry.key] = {
      name: entry.key,
      description: entry.description,
      settings: childSettings,
    };
  }

  if (Object.keys(settings).length === 0) return undefined;
  return { name: key, settings };
};

const resolveForEachArraySource = (
  call: CallExpression,
  checker: TypeChecker
): import('ts-morph').ArrayLiteralExpression | undefined => {
  const propAccess = call.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
  if (!propAccess || propAccess.getName() !== 'forEach') return undefined;
  return resolveArrayLiteral(propAccess.getExpression(), checker);
};

const extractStructuredComponentDefaultsFromForEach = (
  call: CallExpression,
  key: string,
  storeAliases: ReadonlySet<string>,
  checker: TypeChecker
): ComponentStructuredDefault[] => {
  const arraySource = resolveForEachArraySource(call, checker);
  if (!arraySource) return [];

  const arrow = call.getArguments()[0]?.asKind(SyntaxKind.ArrowFunction);
  if (!arrow) return [];

  const assignments = arrow
    .getBody()
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .filter((expr) => expr.getOperatorToken().getKind() === SyntaxKind.EqualsToken);
  if (assignments.length === 0) return [];

  const defaults: ComponentStructuredDefault[] = [];
  for (const element of arraySource.getElements()) {
    const bindings = bindingsForMapItem(arrow, element);
    for (const assignment of assignments) {
      if (
        !leftTargetsStoreBackedSetting(assignment.getLeft(), key, storeAliases, checker, bindings)
      ) {
        continue;
      }

      const elementAccess = unwrapNode(assignment.getLeft()).asKind(
        SyntaxKind.ElementAccessExpression
      );
      const itemKey = extractSettingKey(elementAccess?.getArgumentExpression(), checker, bindings);
      if (!itemKey) continue;

      const defaultObj = unwrapNode(assignment.getRight()).asKind(
        SyntaxKind.ObjectLiteralExpression
      );
      if (!defaultObj) continue;

      const defaultValue = extractObjectLiteralValue(defaultObj, checker, bindings);
      const itemDescriptionValue = extractLiteralValue(element, checker, bindings) as
        | Record<string, unknown>
        | undefined;
      const displayName =
        typeof itemDescriptionValue?.displayName === 'string'
          ? `${itemDescriptionValue.displayName} tag`
          : undefined;
      defaults.push({ key: itemKey, description: displayName, defaults: defaultValue });
    }
  }

  return defaults;
};

export const buildStoreBackedComponentConfig = (
  key: string,
  valueObj: ObjectLiteralExpression,
  checker: TypeChecker
): PluginConfig | undefined => {
  if (!isBareComponentSetting(valueObj)) return undefined;

  const componentInit = getPropertyInitializer(valueObj, COMPONENT_PROPERTY);
  const targets = collectComponentSearchTargets(componentInit, checker);
  if (targets.length === 0) return undefined;

  const structuredDefaults = targets.flatMap((target) => {
    const storeAliases = collectComponentStoreAliases(target.node, key, checker, target.bindings);
    if (
      storeAliases.size === 0 &&
      !nodeReferencesSettingsStoreKey(target.node, key, checker, target.bindings)
    ) {
      return [];
    }

    return target.node
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .flatMap((call) =>
        extractStructuredComponentDefaultsFromForEach(call, key, storeAliases, checker)
      );
  });

  return buildStructuredComponentConfig(key, structuredDefaults);
};

export const buildStoreBackedComponentSetting = (
  key: string,
  valueObj: ObjectLiteralExpression,
  checker: TypeChecker,
  bindings?: ParameterBindings
): PluginSetting | undefined => {
  if (!isBareComponentSetting(valueObj)) return undefined;
  if (!componentReferencesSettingsKey(valueObj, key, checker)) return undefined;

  const props = extractProperties(valueObj, checker, bindings);
  return buildPluginSetting(
    key,
    NIX_TYPE_NULL_OR_STR,
    props.description,
    null,
    undefined,
    undefined,
    props.placeholder,
    props.hidden,
    props.restartNeeded
  );
};
