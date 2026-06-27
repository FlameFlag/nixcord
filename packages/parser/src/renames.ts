import { findMigratePluginSettingCalls, findMigratePluginSettingsCalls } from '@nixcord/ast';
import type { PluginRename, SettingRename } from '@nixcord/shared';
import { type SourceFile, SyntaxKind } from 'ts-morph';

export const extractSettingRenames = (sourceFiles: readonly SourceFile[]): SettingRename[] => {
  const settingRenames: SettingRename[] = [];
  const migrateCalls = sourceFiles.flatMap(findMigratePluginSettingCalls);
  for (const call of migrateCalls) {
    const args = call.getArguments();
    if (args.length >= 3) {
      const callPluginName = args[0].asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
      const oldSetting = args[1].asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
      const newSetting = args[2].asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
      if (callPluginName && newSetting && oldSetting) {
        settingRenames.push({ pluginName: callPluginName, oldSetting, newSetting });
      }
    }
  }
  return settingRenames;
};

export const extractPluginRenames = (sourceFiles: readonly SourceFile[]): PluginRename[] => {
  const pluginRenames: PluginRename[] = [];
  const pluginRenameCalls = sourceFiles.flatMap(findMigratePluginSettingsCalls);
  for (const call of pluginRenameCalls) {
    const args = call.getArguments();
    const newName = args[0]?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
    if (!newName) continue;
    for (const oldArg of args.slice(1)) {
      const oldName = oldArg.asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
      if (oldName) pluginRenames.push({ oldName, newName });
    }
  }
  return pluginRenames;
};
