import { CLI_CONFIG, type Logger } from '@nixcord/shared';
import type { GeneratePluginOptionsSummary } from './runner/index.js';

export function logGeneratePluginOptionsSummary(
  logger: Logger,
  summary: GeneratePluginOptionsSummary
): void {
  const diagnosticSummary = summary.diagnosticSummary
    ? `\n  - parser diagnostics: ${summary.diagnosticSummary.total} total` +
      formatBuckets('by kind', summary.diagnosticSummary.byKind) +
      formatBuckets('top plugins', summary.diagnosticSummary.topPlugins) +
      formatBuckets('top files', summary.diagnosticSummary.topFiles)
    : '';

  logger.success(
    `${CLI_CONFIG.symbols.success} Generated plugin options in ${summary.pluginsDir}:\n` +
      `  - ${CLI_CONFIG.filenames.shared}: ${summary.sharedCount} plugins (shared)\n` +
      `  - ${CLI_CONFIG.filenames.vencord}: ${summary.vencordOnlyCount} plugins (Vencord-only)\n` +
      `  - ${CLI_CONFIG.filenames.equicord}: ${summary.equicordOnlyCount} plugins (Equicord-only)\n` +
      `  - ${CLI_CONFIG.filenames.parseRules}: parser rename rules${diagnosticSummary}`
  );
}

const formatBuckets = (
  label: string,
  buckets: readonly { name: string; count: number }[]
): string =>
  buckets.length === 0
    ? ''
    : `\n    ${label}: ${buckets.map((bucket) => `${bucket.name}=${bucket.count}`).join(', ')}`;
