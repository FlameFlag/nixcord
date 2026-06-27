import {
  type ExtractedSettings,
  type ExtractionResult,
  findDefinePluginSettings,
  type SettingsExtractionDiagnostic,
} from '@nixcord/ast';
import type { ParseDiagnostic } from '@nixcord/shared';

export function diagnosticsFromSettingsExtraction(
  pluginName: string,
  settingsCall: NonNullable<ReturnType<typeof findDefinePluginSettings>>,
  extractionResult: ExtractionResult<ExtractedSettings>
): ParseDiagnostic[] {
  const filePath = settingsCall.getSourceFile().getFilePath();
  return extractionResult.diagnostics.map((diagnostic) =>
    parseDiagnosticFromExtractionDiagnostic(pluginName, filePath, diagnostic)
  );
}

function parseDiagnosticFromExtractionDiagnostic(
  pluginName: string,
  fallbackFilePath: string,
  diagnostic: SettingsExtractionDiagnostic
): ParseDiagnostic {
  const keyPrefix = diagnostic.key ? ` setting "${diagnostic.key}"` : '';
  const extractorSuffix = diagnostic.extractor ? ` (${diagnostic.extractor})` : '';
  return {
    pluginName,
    filePath: diagnostic.node?.getSourceFile().getFilePath() ?? fallbackFilePath,
    kind: diagnostic.kind,
    message: `${diagnostic.message}${keyPrefix}${extractorSuffix}`,
  };
}
