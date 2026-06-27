import type { PluginSetting } from '@nixcord/shared';
import { SyntaxKind } from 'ts-morph';
import { expect, test } from 'vitest';
import { extractSettingsFromCall } from '../../../../../src/extractor/settings-extractor.js';
import { createProject } from '../../../../helpers/test-utils.js';

test('CUSTOM with static Object.fromEntries default resolves attrs default object', () => {
  const project = createProject();
  const sourceFile = project.createSourceFile(
    'test.ts',
    `import { definePluginSettings, OptionType } from "@utils/types";
      const Providers = { Spotify: { native: true }, Apple: { native: false } } as const;
      const settings = definePluginSettings({
        servicesSettings: {
          type: OptionType.CUSTOM,
          description: "settings for services",
          default: Object.fromEntries(Object.entries(Providers).map(([name, data]) => [name, {
            enabled: true,
            openInNative: (data as any).native || false
          }]))
        }
      });`
  );
  const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
  if (!callExpr) throw new Error('Call expression not found');
  const checker = project.getTypeChecker();
  const program = project.getProgram();
  const result = extractSettingsFromCall(callExpr, checker, program);
  const ss = result.servicesSettings as PluginSetting;
  expect(ss).toBeDefined();
  expect(ss.type).toBe('types.attrs');
  expect(ss.default).toEqual({
    Spotify: { enabled: true, openInNative: true },
    Apple: { enabled: true, openInNative: false },
  });
});

test('STRING without explicit default -> nullOr types.str with null', () => {
  const project = createProject();
  const sourceFile = project.createSourceFile(
    'test.ts',
    `import { definePluginSettings, OptionType } from "@utils/types";
      const settings = definePluginSettings({
        country: {
          type: OptionType.STRING,
          description: "Country code"
        }
      });`
  );
  const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
  if (!callExpr) throw new Error('Call expression not found');
  const checker = project.getTypeChecker();
  const program = project.getProgram();
  const result = extractSettingsFromCall(callExpr, checker, program);
  const country = result.country as PluginSetting;
  expect(country.type).toBe('types.nullOr types.str');
  expect(country.default).toBeNull();
});

test('COMPONENT [] as string[] default -> listOf types.str with []', () => {
  const project = createProject();
  const sourceFile = project.createSourceFile(
    'test.ts',
    `import { definePluginSettings, OptionType } from "@utils/types";
      const DEFAULTS = [] as string[];
      const settings = definePluginSettings({
        reasons: {
          type: OptionType.COMPONENT,
          description: "Reasons",
          default: DEFAULTS
        }
      });`
  );
  const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
  if (!callExpr) throw new Error('Call expression not found');
  const checker = project.getTypeChecker();
  const program = project.getProgram();
  const result = extractSettingsFromCall(callExpr, checker, program);
  const reasons = result.reasons as PluginSetting;
  expect(reasons.type).toBe('types.listOf types.str');
  expect(reasons.default).toEqual([]);
});

test('COMPONENT bare (only component) -> filtered out', () => {
  const project = createProject();
  const sourceFile = project.createSourceFile(
    'test.ts',
    `import { definePluginSettings, OptionType } from "@utils/types";
      const settings = definePluginSettings({
        hotkey: {
          type: OptionType.COMPONENT,
          component: () => null
        }
      });`
  );
  const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
  if (!callExpr) throw new Error('Call expression not found');
  const checker = project.getTypeChecker();
  const program = project.getProgram();
  const result = extractSettingsFromCall(callExpr, checker, program);
  expect(result.hotkey).toBeUndefined();
});

test('CUSTOM identifier default resolving to object literal preserves object', () => {
  const project = createProject();
  const sourceFile = project.createSourceFile(
    'test.ts',
    `import { definePluginSettings, OptionType } from "@utils/types";
      const DEFAULT_OBJ = { a: 1, b: "two" } as const;
      const settings = definePluginSettings({
        complex: {
          type: OptionType.CUSTOM,
          description: "Complex",
          default: DEFAULT_OBJ
        }
      });`
  );
  const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
  if (!callExpr) throw new Error('Call expression not found');
  const checker = project.getTypeChecker();
  const program = project.getProgram();
  const result = extractSettingsFromCall(callExpr, checker, program);
  const complex = result.complex as PluginSetting;
  expect(complex.type).toBe('types.attrs');
  expect(complex.default).toEqual({ a: 1, b: 'two' });
});

test('CUSTOM identifier default resolving to array of objects preserves array', () => {
  const project = createProject();
  const sourceFile = project.createSourceFile(
    'test.ts',
    `import { definePluginSettings, OptionType } from "@utils/types";
      const DEFAULT_LIST = [{ a: 1 }, { b: 2 }] as const;
      const settings = definePluginSettings({
        list: {
          type: OptionType.CUSTOM,
          description: "List",
          default: DEFAULT_LIST
        }
      });`
  );
  const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
  if (!callExpr) throw new Error('Call expression not found');
  const checker = project.getTypeChecker();
  const program = project.getProgram();
  const result = extractSettingsFromCall(callExpr, checker, program);
  const list = result.list as PluginSetting;
  expect(list.type).toBe('types.listOf types.attrs');
  expect(list.default).toEqual([{ a: 1 }, { b: 2 }]);
});

test('setting helper call returning satisfies object is extracted', () => {
  const project = createProject();
  const sourceFile = project.createSourceFile(
    'test.ts',
    `import { definePluginSettings, OptionType, PluginSettingDef } from "@utils/types";
      const opt = (description: string) => ({
        type: OptionType.BOOLEAN,
        description,
        default: true,
        restartNeeded: true
      } satisfies PluginSettingDef);
      const settings = definePluginSettings({
        showTimeouts: opt("Show member timeout icons in chat."),
        showInvitesPaused: opt("Show the invites paused tooltip in the server list."),
        showModView: opt("Show the member mod view context menu item in all servers.")
      });`
  );
  const callExpr = sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((call) => call.getExpression().getText() === 'definePluginSettings');
  if (!callExpr) throw new Error('Call expression not found');
  const checker = project.getTypeChecker();
  const program = project.getProgram();
  const result = extractSettingsFromCall(callExpr, checker, program);
  const showTimeouts = result.showTimeouts as PluginSetting;
  expect(showTimeouts.type).toBe('types.bool');
  expect(showTimeouts.default).toBe(true);
  expect(showTimeouts.description).toBe('Show member timeout icons in chat. (restart required)');
  expect(showTimeouts.restartNeeded).toBe(true);
  expect(Object.keys(result)).toHaveLength(3);
});
