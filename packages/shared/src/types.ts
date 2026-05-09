import { z } from 'zod';
import type { ReadonlyDeep, Simplify, Exact, SetRequired } from './type-utils.js';

export interface PluginSetting {
  readonly name: string;
  readonly type: string;
  readonly description?: string;
  readonly default?: unknown;
  readonly enumValues?: readonly (string | number | boolean)[];
  readonly enumLabels?: ReadonlyDeep<Record<string, string> & Partial<Record<number, string>>>;
  readonly example?: string;
  readonly hidden?: boolean;
  readonly restartNeeded?: boolean;
}

export type PluginSettingRequired = SetRequired<PluginSetting, 'name' | 'type'>;

export interface PluginConfig {
  readonly name: string;
  readonly description?: string;
  readonly isModified?: boolean;
  readonly settings: ReadonlyDeep<Record<string, PluginSetting | PluginConfig>>;
  readonly directoryName?: string;
}

const PluginSettingSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string().optional(),
  default: z.unknown().optional(),
  enumValues: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  enumLabels: z.record(z.union([z.string(), z.number()]), z.string()).optional(),
  example: z.string().optional(),
  hidden: z.boolean().optional(),
  restartNeeded: z.boolean().optional(),
});

const PluginConfigSchema = z.lazy(() =>
  z.object({
    name: z.string(),
    description: z.string().optional(),
    isModified: z.boolean().optional(),
    settings: z.record(z.string(), z.union([PluginSettingSchema, PluginConfigSchema])),
    directoryName: z.string().optional(),
  })
) as z.ZodType<PluginConfig>;

const SettingRenameSchema = z.object({
  pluginName: z.string(),
  oldSetting: z.string(),
  newSetting: z.string(),
});

const PluginRenameSchema = z.object({
  oldName: z.string(),
  newName: z.string(),
});

const ParseDiagnosticSchema = z.object({
  pluginName: z.string().optional(),
  filePath: z.string().optional(),
  kind: z.string(),
  message: z.string(),
});

export const ParsedPluginsResultSchema = z.object({
  vencordPlugins: z.record(z.string(), PluginConfigSchema),
  equicordPlugins: z.record(z.string(), PluginConfigSchema),
  settingRenames: z.array(SettingRenameSchema).optional(),
  pluginRenames: z.array(PluginRenameSchema).optional(),
  diagnostics: z.array(ParseDiagnosticSchema).optional(),
});

export interface ParsedPluginsResult {
  readonly vencordPlugins: ReadonlyDeep<Record<string, PluginConfig>>;
  readonly equicordPlugins: ReadonlyDeep<Record<string, PluginConfig>>;
  readonly settingRenames?: readonly SettingRename[];
  readonly pluginRenames?: readonly PluginRename[];
  readonly diagnostics?: readonly ParseDiagnostic[];
}

export interface SettingRename {
  readonly pluginName: string;
  readonly oldSetting: string;
  readonly newSetting: string;
}

export interface PluginRename {
  readonly oldName: string;
  readonly newName: string;
}

export interface ParseDiagnostic {
  readonly pluginName?: string;
  readonly filePath?: string;
  readonly kind: string;
  readonly message: string;
}

export interface PluginInfo {
  readonly name?: string;
  readonly description?: string;
}

export type DeprecatedRenameEntry = {
  to: string;
  date?: string;
};

export type DeprecatedRemovalEntry = {
  date: string;
};

export type DeprecatedData = {
  renames: Record<string, DeprecatedRenameEntry>;
  removals: Record<string, DeprecatedRemovalEntry>;
  settingRenames: Record<string, Record<string, string>>;
};

export type PluginInfoStrict = Simplify<Exact<PluginInfo, PluginInfo>>;

export const OptionTypeMap: Readonly<Record<number, string>> = {
  0: 'STRING',
  1: 'NUMBER',
  2: 'BIGINT',
  3: 'BOOLEAN',
  4: 'SELECT',
  5: 'SLIDER',
  6: 'COMPONENT',
  7: 'CUSTOM',
} as const;
