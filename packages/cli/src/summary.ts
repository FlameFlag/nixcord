import { CLI_CONFIG, type Logger } from '@nixcord/shared';
import type { GeneratePluginOptionsSummary } from './runner/index.js';

export function logGeneratePluginOptionsSummary(
  logger: Logger,
  summary: GeneratePluginOptionsSummary
): void {
  logger.success(
    `${CLI_CONFIG.symbols.success} Generated plugin options in ${summary.pluginsDir}:\n` +
      `  - ${CLI_CONFIG.filenames.shared}: ${summary.sharedCount} plugins (shared)\n` +
      `  - ${CLI_CONFIG.filenames.vencord}: ${summary.vencordOnlyCount} plugins (Vencord-only)\n` +
      `  - ${CLI_CONFIG.filenames.equicord}: ${summary.equicordOnlyCount} plugins (Equicord-only)\n` +
      `  - ${CLI_CONFIG.filenames.parseRules}: parser rename rules`
  );
}
