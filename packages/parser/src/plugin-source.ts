/**
 * Plugin source abstraction for framework-agnostic parsing.
 *
 * This interface allows the parser to work with any plugin framework,
 * not just Vencord/Equicord. Framework-specific logic is moved to the CLI layer.
 */

/**
 * Represents a plugin source (Vencord, Equicord, or future frameworks).
 */
export interface PluginSource {
  /** Name of the framework (e.g., 'vencord', 'equicord', 'custom') */
  readonly name: string;

  /** Path to the plugins directory relative to the source root */
  readonly pluginsDirectory: string;

  /** File patterns to search for plugin definitions (e.g., ['index.tsx', 'index.ts', 'settings.ts']) */
  readonly filePatterns: readonly string[];

  /** Optional: Specific paths to add to the TypeScript project (e.g., enum files) */
  readonly additionalPaths?: readonly string[];
}

/**
 * Creates a Vencord plugin source.
 */
export function createVencordSource(pluginsDir: string): PluginSource {
  return {
    name: 'vencord',
    pluginsDirectory: pluginsDir,
    filePatterns: ['index.tsx', 'index.ts', 'settings.ts'],
    additionalPaths: ['src/utils/types.ts', 'packages/discord-types/enums'],
  };
}

/**
 * Creates an Equicord plugin source.
 */
export function createEquicordSource(pluginsDir: string): PluginSource {
  return {
    name: 'equicord',
    pluginsDirectory: pluginsDir,
    filePatterns: ['index.tsx', 'index.ts', 'settings.ts'],
    additionalPaths: [
      'src/utils/types.ts',
      'packages/discord-types/enums',
      'src/plugins/shikiCodeblocks.desktop/api/themes.ts',
    ],
  };
}
