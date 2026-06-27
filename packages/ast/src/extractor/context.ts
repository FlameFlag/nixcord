import type { Program, SourceFile, TypeChecker } from 'ts-morph';
import type { ParameterBindings } from './bindings.js';
import {
  createExtractionResult,
  type ExtractedSettings,
  type ExtractionResult,
  type SettingsExtractionDiagnostic,
  type SettingsExtractionSkip,
  type SettingsExtractionUnsupported,
} from './types.js';

export interface ExtractionContext {
  readonly checker: TypeChecker;
  readonly program: Program;
  readonly sourceFile?: SourceFile | undefined;
  readonly bindings?: ParameterBindings | undefined;
  readonly diagnostics: readonly SettingsExtractionDiagnostic[];
  readonly visited: ReadonlySet<string>;
}

export const createExtractionContext = (
  checker: TypeChecker,
  program: Program,
  bindings?: ParameterBindings
): ExtractionContext => ({
  checker,
  program,
  bindings,
  diagnostics: [],
  visited: new Set<string>(),
});

export const withBindings = (
  context: ExtractionContext,
  bindings: ParameterBindings | undefined
): ExtractionContext => ({
  ...context,
  bindings,
});

export const withSourceFile = (
  context: ExtractionContext,
  sourceFile: SourceFile | undefined
): ExtractionContext => ({
  ...context,
  sourceFile,
});

export const settingsResult = (
  items: ExtractedSettings,
  diagnostics: readonly SettingsExtractionDiagnostic[] = [],
  skipped: readonly SettingsExtractionSkip[] = [],
  unsupported: readonly SettingsExtractionUnsupported[] = []
): ExtractionResult<ExtractedSettings> =>
  createExtractionResult(items, diagnostics, skipped, unsupported);

export const mergeSettingsResults = (
  ...results: readonly ExtractionResult<ExtractedSettings>[]
): ExtractionResult<ExtractedSettings> =>
  settingsResult(
    Object.assign({}, ...results.map((result) => result.items)),
    results.flatMap((result) => result.diagnostics),
    results.flatMap((result) => result.skipped),
    results.flatMap((result) => result.unsupported)
  );

export const extractionDiagnostic = (
  kind: SettingsExtractionDiagnostic['kind'],
  message: string,
  node: SettingsExtractionDiagnostic['node'],
  key?: string,
  extractor?: string
): SettingsExtractionDiagnostic => ({
  kind,
  message,
  node,
  key,
  extractor,
});

export const skippedSetting = (
  kind: SettingsExtractionSkip['kind'],
  key: string,
  message: string,
  node: SettingsExtractionSkip['node'],
  extractor?: string
): SettingsExtractionSkip => ({
  kind,
  key,
  message,
  node,
  extractor,
});

export const unsupportedSetting = (
  kind: SettingsExtractionUnsupported['kind'],
  message: string,
  node: SettingsExtractionUnsupported['node'],
  key?: string,
  extractor?: string
): SettingsExtractionUnsupported => ({
  kind,
  message,
  node,
  key,
  extractor,
});

export const skipResult = (skip: SettingsExtractionSkip): ExtractionResult<ExtractedSettings> =>
  settingsResult({}, [skip], [skip]);

export const unsupportedResult = (
  unsupported: SettingsExtractionUnsupported
): ExtractionResult<ExtractedSettings> => settingsResult({}, [unsupported], [], [unsupported]);
