import type { PluginConfig, PluginSetting } from '@nixcord/shared';
import type {
  Node,
  ObjectLiteralExpression,
  Program,
  PropertyAssignment,
  TypeChecker,
} from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import {
  iteratePropertyAssignments,
  resolveIdentifierInitializerNode,
  unwrapNode,
} from '../foundation/index.js';
import { tsTypeToNixType } from '../parser.js';
import type { ParameterBindings } from './bindings.js';
import {
  buildStoreBackedComponentConfig,
  buildStoreBackedComponentSetting,
} from './component-settings.js';
import {
  createExtractionContext,
  type ExtractionContext,
  extractionDiagnostic,
  mergeSettingsResults,
  settingsResult,
  skippedSetting,
  skipResult,
  unsupportedResult,
  unsupportedSetting,
  withBindings,
  withSourceFile,
} from './context.js';
import { isBareComponentSetting, resolveDefaultValue } from './default-value-resolution.js';
import {
  extractGeneratedSettingsFromObjectEntriesReduce,
  extractSettingsFromObjectFromEntries,
} from './generated-settings.js';
import { extractPrivateSettingsFromChainedCall } from './private-settings.js';
import { extractSelectOptions } from './select/index.js';
import {
  buildPluginSetting,
  extractProperties,
  isSettingsGroup,
  resolveSettingValueObject,
} from './setting-shape.js';
import type { ExtractedSettings, ExtractionResult } from './types.js';

const isHiddenSetting = (valueObj: ObjectLiteralExpression): boolean =>
  valueObj
    .getProperty('hidden')
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.getKind() === SyntaxKind.TrueKeyword;

const extractNormalSetting = (
  key: string,
  valueObj: ObjectLiteralExpression,
  context: ExtractionContext
): PluginSetting => {
  const props = extractProperties(valueObj, context.checker, context.bindings);
  const optionsResult = extractSelectOptions(valueObj, context.checker);
  const extractedOptions = optionsResult.ok ? optionsResult.value.values : undefined;
  const nonEmptyExtractedOptions =
    extractedOptions && extractedOptions.length > 0 ? extractedOptions : undefined;
  const extractedLabels = optionsResult.ok ? optionsResult.value.labels : undefined;

  const typeResult = tsTypeToNixType(
    {
      type: props.typeNode,
      default: props.defaultLiteralValue,
      options: nonEmptyExtractedOptions ?? props.typeAssertionEnumValues,
    },
    context.program,
    context.checker
  );
  const defaultResolution = resolveDefaultValue(
    valueObj,
    typeResult.nixType,
    props.defaultLiteralValue,
    typeResult.enumValues,
    context.checker
  );

  return buildPluginSetting(
    key,
    defaultResolution.finalNixType,
    props.description,
    defaultResolution.defaultValue,
    typeResult.enumValues,
    nonEmptyExtractedOptions ? extractedLabels : undefined,
    props.placeholder,
    props.hidden,
    props.restartNeeded
  );
};

const extractSettingFromValueObjectDetailed = (
  key: string,
  valueObj: ObjectLiteralExpression,
  context: ExtractionContext,
  skipHiddenCheck: boolean
): ExtractionResult<ExtractedSettings> => {
  if (!skipHiddenCheck && isHiddenSetting(valueObj)) {
    return skipResult(
      skippedSetting(
        'hidden-setting-skipped',
        key,
        `Skipped hidden setting "${key}"`,
        valueObj,
        'object-literal-settings'
      )
    );
  }

  const nestedProperties = Array.from(iteratePropertyAssignments(valueObj));
  if (isSettingsGroup(nestedProperties)) {
    const nestedResult = extractSettingsFromPropertyIterableDetailed(
      nestedProperties,
      context.checker,
      context.program,
      skipHiddenCheck,
      context.bindings
    );
    return settingsResult(
      {
        [key]: {
          name: key,
          settings: nestedResult.items as Record<string, PluginSetting>,
        },
      },
      nestedResult.diagnostics,
      nestedResult.skipped,
      nestedResult.unsupported
    );
  }

  const props = extractProperties(valueObj, context.checker, context.bindings);
  if (!skipHiddenCheck && props.hidden) {
    return skipResult(
      skippedSetting(
        'hidden-setting-skipped',
        key,
        `Skipped hidden setting "${key}"`,
        valueObj,
        'object-literal-settings'
      )
    );
  }

  const componentConfig = buildStoreBackedComponentConfig(key, valueObj, context.checker);
  if (componentConfig) return settingsResult({ [key]: componentConfig });

  const componentSetting = buildStoreBackedComponentSetting(
    key,
    valueObj,
    context.checker,
    context.bindings
  );
  if (componentSetting) return settingsResult({ [key]: componentSetting });

  if (isBareComponentSetting(valueObj)) {
    return skipResult(
      skippedSetting(
        'component-only-setting-skipped',
        key,
        `Skipped component-only setting "${key}" because no persistent store-backed value could be resolved`,
        valueObj,
        'component-settings'
      )
    );
  }

  return settingsResult({ [key]: extractNormalSetting(key, valueObj, context) });
};

const extractSettingsFromResolvedValueDetailed = (
  key: string,
  value: Node,
  context: ExtractionContext,
  skipHiddenCheck: boolean
): ExtractionResult<ExtractedSettings> => {
  const source = resolveSettingValueObject(value, context.checker, context.bindings);
  if (!source) {
    return unsupportedResult(
      unsupportedSetting(
        'unsupported-settings-argument',
        `Could not resolve setting "${key}" to a static object literal`,
        value,
        key,
        'object-literal-settings'
      )
    );
  }

  return extractSettingFromValueObjectDetailed(
    key,
    source.valueObj,
    withBindings(context, source.bindings),
    skipHiddenCheck
  );
};

interface SettingsPatternExtractor {
  readonly name: string;
  readonly canHandle: (node: Node) => boolean;
  readonly extract: (
    node: Node,
    context: ExtractionContext,
    skipHiddenCheck: boolean
  ) => ExtractionResult<ExtractedSettings>;
}

const isObjectLiteralNode = (node: Node): boolean =>
  node.getKind() === SyntaxKind.ObjectLiteralExpression;

const isObjectFromEntriesCall = (node: Node): boolean => {
  const call = node.asKind(SyntaxKind.CallExpression);
  const propAccess = call?.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
  return (
    propAccess?.getExpression().getText() === 'Object' && propAccess.getName() === 'fromEntries'
  );
};

const isObjectEntriesReduceCall = (node: Node): boolean => {
  const call = node.asKind(SyntaxKind.CallExpression);
  const propAccess = call?.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
  return propAccess?.getName() === 'reduce';
};

const spreadExtractors: readonly SettingsPatternExtractor[] = [
  {
    name: 'object-literal-settings',
    canHandle: isObjectLiteralNode,
    extract: (node, context, skipHiddenCheck) =>
      extractSettingsFromObjectDetailed(
        node.asKindOrThrow(SyntaxKind.ObjectLiteralExpression),
        context.checker,
        context.program,
        skipHiddenCheck
      ),
  },
  {
    name: 'Object.fromEntries(...map(...))',
    canHandle: isObjectFromEntriesCall,
    extract: (node, context, skipHiddenCheck) =>
      extractSettingsFromObjectFromEntries(
        node.asKindOrThrow(SyntaxKind.CallExpression),
        context,
        skipHiddenCheck,
        (pair, pairSkipHiddenCheck) =>
          extractSettingsFromResolvedValueDetailed(
            pair.key,
            pair.value,
            pair.context,
            pairSkipHiddenCheck
          )
      ),
  },
];

const settingsArgumentExtractors: readonly SettingsPatternExtractor[] = [
  spreadExtractors[0],
  spreadExtractors[1],
  {
    name: 'Object.entries(...).reduce(...)',
    canHandle: isObjectEntriesReduceCall,
    extract: extractGeneratedSettingsFromObjectEntriesReduce,
  },
];

const extractSettingsFromSpreadExpression = (
  node: Node,
  context: ExtractionContext,
  skipHiddenCheck: boolean
): ExtractionResult<ExtractedSettings> => {
  const unwrapped = unwrapNode(node);

  const ident = unwrapped.asKind(SyntaxKind.Identifier);
  if (ident) {
    const init = resolveIdentifierInitializerNode(ident, context.checker);
    return init
      ? extractSettingsFromSpreadExpression(init, context, skipHiddenCheck)
      : settingsResult({}, [
          extractionDiagnostic(
            'unresolved-settings-identifier',
            `Could not resolve spread settings identifier "${ident.getText()}"`,
            ident,
            undefined,
            'object-spread-settings'
          ),
        ]);
  }

  const binExpr = unwrapped.asKind(SyntaxKind.BinaryExpression);
  if (
    binExpr &&
    [SyntaxKind.BarBarToken, SyntaxKind.QuestionQuestionToken].includes(
      binExpr.getOperatorToken().getKind()
    )
  ) {
    return mergeSettingsResults(
      extractSettingsFromSpreadExpression(binExpr.getRight(), context, skipHiddenCheck),
      extractSettingsFromSpreadExpression(binExpr.getLeft(), context, skipHiddenCheck)
    );
  }

  const extractor = spreadExtractors.find((candidate) => candidate.canHandle(unwrapped));
  return extractor
    ? extractor.extract(unwrapped, context, skipHiddenCheck)
    : unsupportedResult(
        unsupportedSetting(
          'unsupported-settings-argument',
          `Unsupported spread settings expression: ${unwrapped.getText()}`,
          unwrapped,
          undefined,
          'object-spread-settings'
        )
      );
};

export function extractSettingsFromPropertyIterableDetailed(
  properties: Iterable<PropertyAssignment>,
  checker: TypeChecker,
  program: Program,
  skipHiddenCheck = false,
  baseBindings?: ParameterBindings
): ExtractionResult<ExtractedSettings> {
  const context = createExtractionContext(checker, program, baseBindings);
  const results: ExtractionResult<ExtractedSettings>[] = [];

  for (const propAssignment of properties) {
    const key = propAssignment.getName();
    const init = propAssignment.getInitializer();
    if (!key || !init) continue;

    results.push(extractSettingsFromResolvedValueDetailed(key, init, context, skipHiddenCheck));
  }

  return mergeSettingsResults(...results);
}

export function extractSettingsFromPropertyIterable(
  properties: Iterable<PropertyAssignment>,
  checker: TypeChecker,
  program: Program,
  skipHiddenCheck = false,
  baseBindings?: ParameterBindings
): Record<string, PluginSetting | PluginConfig> {
  return extractSettingsFromPropertyIterableDetailed(
    properties,
    checker,
    program,
    skipHiddenCheck,
    baseBindings
  ).items;
}

export function extractSettingsFromObjectDetailed(
  objExpr: ObjectLiteralExpression,
  checker: TypeChecker,
  program: Program,
  skipHiddenCheck = false
): ExtractionResult<ExtractedSettings> {
  const context = withSourceFile(
    createExtractionContext(checker, program),
    objExpr.getSourceFile()
  );
  const results: ExtractionResult<ExtractedSettings>[] = [];
  for (const prop of objExpr.getProperties()) {
    if (prop.getKind() === SyntaxKind.PropertyAssignment) {
      results.push(
        extractSettingsFromPropertyIterableDetailed(
          [prop.asKindOrThrow(SyntaxKind.PropertyAssignment)],
          checker,
          program,
          skipHiddenCheck
        )
      );
      continue;
    }

    const spread = prop.asKind(SyntaxKind.SpreadAssignment);
    if (!spread) continue;
    results.push(
      extractSettingsFromSpreadExpression(spread.getExpression(), context, skipHiddenCheck)
    );
  }
  return mergeSettingsResults(...results);
}

export function extractSettingsFromObject(
  objExpr: ObjectLiteralExpression,
  checker: TypeChecker,
  program: Program,
  skipHiddenCheck = false
): Record<string, PluginSetting | PluginConfig> {
  return extractSettingsFromObjectDetailed(objExpr, checker, program, skipHiddenCheck).items;
}

export function extractSettingsFromCallDetailed(
  callExpr: Node | undefined,
  checker: TypeChecker,
  program: Program,
  skipHiddenCheck = false
): ExtractionResult<ExtractedSettings> {
  const context = createExtractionContext(checker, program);
  if (!callExpr || callExpr.getKind() !== SyntaxKind.CallExpression) {
    return unsupportedResult(
      unsupportedSetting(
        'unsupported-settings-argument',
        'Expected a definePluginSettings call expression',
        callExpr,
        undefined,
        'definePluginSettings'
      )
    );
  }
  const expr = callExpr.asKindOrThrow(SyntaxKind.CallExpression);
  const callContext = withSourceFile(context, expr.getSourceFile());
  const privateSettings = extractPrivateSettingsFromChainedCall(expr, checker, program);
  const args = expr.getArguments();
  const privateResult = settingsResult(privateSettings);
  if (args.length === 0) {
    return Object.keys(privateSettings).length > 0
      ? privateResult
      : unsupportedResult(
          unsupportedSetting(
            'unsupported-settings-argument',
            'definePluginSettings() has no settings argument',
            expr,
            undefined,
            'definePluginSettings'
          )
        );
  }

  const arg = args[0];
  const identifier = arg.asKind(SyntaxKind.Identifier);
  const resolvedIdentifierArg = identifier
    ? resolveIdentifierInitializerNode(identifier, callContext.checker)
    : undefined;

  if (identifier && !resolvedIdentifierArg) {
    return mergeSettingsResults(
      settingsResult({}, [
        extractionDiagnostic(
          'unresolved-settings-identifier',
          `Could not resolve settings identifier "${identifier.getText()}"`,
          identifier,
          undefined,
          'definePluginSettings'
        ),
      ]),
      privateResult
    );
  }

  const settingsArg = resolvedIdentifierArg ?? arg;
  const extractor = settingsArgumentExtractors.find((candidate) =>
    candidate.canHandle(settingsArg)
  );

  const publicSettings = extractor
    ? extractor.extract(settingsArg, callContext, skipHiddenCheck)
    : unsupportedResult(
        unsupportedSetting(
          'unsupported-settings-argument',
          `Unsupported definePluginSettings argument: ${settingsArg.getText()}`,
          settingsArg,
          undefined,
          'definePluginSettings'
        )
      );

  return mergeSettingsResults(publicSettings, privateResult);
}

export function extractSettingsFromCall(
  callExpr: Node | undefined,
  checker: TypeChecker,
  program: Program,
  skipHiddenCheck = false
): Record<string, PluginSetting | PluginConfig> {
  return extractSettingsFromCallDetailed(callExpr, checker, program, skipHiddenCheck).items;
}
