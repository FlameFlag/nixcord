import type { PluginConfig, PluginSetting } from '@nixcord/shared';
import { SyntaxKind } from 'ts-morph';
import { describe, expect, test } from 'vitest';
import {
  extractSettingsFromCall,
  extractSettingsFromCallDetailed,
} from '../../../../../src/extractor/settings-extractor.js';
import { findDefinePluginSettings } from '../../../../../src/navigator/plugin-navigator.js';
import { createProject } from '../../../../helpers/test-utils.js';

describe('extractSettingsFromCall()', () => {
  test('extracts simple settings', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `export const enum OptionType {
        STRING = 0,
        NUMBER = 1,
        BIGINT = 2,
        BOOLEAN = 3,
        SELECT = 4,
        SLIDER = 5,
        COMPONENT = 6,
        CUSTOM = 7
      }
      function definePluginSettings(settings: Record<string, unknown>) {
        return settings;
      }
      definePluginSettings({
        setting1: {
          type: OptionType.STRING,
          description: "Setting 1",
          default: "value1"
        }
      });`
    );
    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
    if (!callExpr) {
      throw new Error('Call expression not found');
    }
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromCall(callExpr, checker, program);
    expect(result.setting1).toBeDefined();
    expect(result.setting1?.name).toBe('setting1');
    if (result.setting1 && 'type' in result.setting1) {
      expect(result.setting1.type).toBe('types.str');
    }
  });

  test('emits numeric enum literals for SELECT options', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `export const enum OptionType {
         STRING = 0,
         NUMBER = 1,
         BIGINT = 2,
         BOOLEAN = 3,
         SELECT = 4,
         SLIDER = 5,
         COMPONENT = 6,
         CUSTOM = 7
       }
       function definePluginSettings(settings: Record<string, unknown>) {
         return settings;
       }
       const enum Spacing {
         COMPACT,
         COZY
       }
       definePluginSettings({
         iconSpacing: {
           type: OptionType.SELECT,
           description: "Spacing",
           options: [
             { label: "Compact", value: Spacing.COMPACT },
             { label: "Cozy", value: Spacing.COZY }
           ],
           default: Spacing.COZY
         }
       });`
    );
    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
    if (!callExpr) throw new Error('Call expression not found');
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromCall(callExpr, checker, program);
    const iconSpacing = result.iconSpacing as PluginSetting;
    expect(iconSpacing.enumValues).toEqual([0, 1]);
    expect(iconSpacing.default).toBe(1);
  });

  test('extracts SELECT options from const object property access values', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `export const enum OptionType {
         STRING = 0,
         NUMBER = 1,
         BIGINT = 2,
         BOOLEAN = 3,
         SELECT = 4,
         SLIDER = 5,
         COMPONENT = 6,
         CUSTOM = 7
       }
       function definePluginSettings(settings: Record<string, unknown>) {
         return settings;
       }
       const Quality = {
         High: 1,
         Reasonable: 2,
         Low: 3,
         Horrible: 4,
       } as const;
       definePluginSettings({
         gifQuality: {
           type: OptionType.SELECT,
           description: "GIF quality",
           options: [
             { label: "High", value: Quality.High, default: true },
             { label: "Reasonable", value: Quality.Reasonable },
             { label: "Low", value: Quality.Low },
             { label: "Horrible", value: Quality.Horrible }
           ]
         }
       });`
    );
    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
    if (!callExpr) throw new Error('Call expression not found');
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromCall(callExpr, checker, program);
    const gifQuality = result.gifQuality as PluginSetting;
    expect(gifQuality.enumValues).toEqual([1, 2, 3, 4]);
    expect(gifQuality.default).toBe(1);
    expect(gifQuality.description).toBe('GIF quality');
  });

  test('keeps string literal enums as strings', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `import { definePluginSettings, OptionType } from "@utils/types";
       const settings = definePluginSettings({
         automodEmbeds: {
           type: OptionType.SELECT,
           description: "Embeds",
           options: [
             { label: "Always", value: "always" },
             { label: "Never", value: "never" }
           ],
           default: "always"
         }
       });`
    );
    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
    if (!callExpr) throw new Error('Call expression not found');
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromCall(callExpr, checker, program);
    const automod = result.automodEmbeds as PluginSetting;
    expect(automod.enumValues).toEqual(['always', 'never']);
    expect(automod.enumValues).toEqual(['always', 'never']);
  });

  test('extracts nested settings (PluginConfig)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `definePluginSettings({
        config: {
          nested: {
            type: OptionType.STRING,
            description: "Nested setting",
            default: "value"
          }
        }
      });`
    );
    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
    if (!callExpr) {
      throw new Error('Call expression not found');
    }
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromCall(callExpr, checker, program);
    expect(result.config).toBeDefined();
    if (result.config && 'settings' in result.config) {
      const settings = (result.config as PluginConfig).settings;
      expect(settings.nested).toBeDefined();
    }
  });

  test('filters hidden settings', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `definePluginSettings({
        visible: {
          type: OptionType.STRING,
          description: "Visible"
        },
        hidden: {
          type: OptionType.STRING,
          description: "Hidden",
          hidden: true
        }
      });`
    );
    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
    if (!callExpr) {
      throw new Error('Call expression not found');
    }
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromCall(callExpr, checker, program);
    expect(result.visible).toBeDefined();
    expect(result.hidden).toBeUndefined();
  });

  test('handles restart required suffix', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `definePluginSettings({
        setting: {
          type: OptionType.STRING,
          description: "Requires restart",
          restartNeeded: true
        }
      });`
    );
    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
    if (!callExpr) {
      throw new Error('Call expression not found');
    }
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromCall(callExpr, checker, program);
    const setting = result.setting;
    if (setting && 'description' in setting) {
      expect(setting.description).toContain('(restart required)');
    }
  });

  test('handles enum types with OptionType enum (real plugin pattern)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `export const enum OptionType {
        STRING = 0,
        NUMBER = 1,
        BIGINT = 2,
        BOOLEAN = 3,
        SELECT = 4,
        SLIDER = 5,
        COMPONENT = 6,
        CUSTOM = 7
      }
      function definePluginSettings(settings: Record<string, unknown>) {
        return settings;
      }
      definePluginSettings({
        choice: {
          type: OptionType.SELECT,
          description: "Choose option",
          options: [
            { value: "option1" },
            { value: "option2" }
          ]
        },
        enabled: {
          type: OptionType.BOOLEAN,
          description: "Enable feature",
          default: true
        },
        message: {
          type: OptionType.STRING,
          description: "Message",
          default: "test"
        }
      });`
    );
    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
    if (!callExpr) {
      throw new Error('Call expression not found');
    }
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromCall(callExpr, checker, program);

    const choice = result.choice;
    expect(choice).toBeDefined();
    if (choice && 'type' in choice) {
      expect(choice.type).toContain('enum');
      const enumValues = (choice as PluginSetting).enumValues;
      if (enumValues !== undefined) {
        expect(Array.isArray(enumValues)).toBe(true);
        expect(enumValues.length).toBeGreaterThan(0);
      }
    }

    const enabled = result.enabled;
    expect(enabled).toBeDefined();
    if (enabled && 'type' in enabled) {
      expect(enabled.type).toBe('types.bool');
      expect(enabled.default).toBe(true);
    }

    const message = result.message;
    expect(message).toBeDefined();
    if (message && 'type' in message) {
      expect(message.type).toBe('types.str');
      expect(message.default).toBe('test');
    }
  });

  test('handles all default value types', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `export const enum OptionType {
        STRING = 0,
        NUMBER = 1,
        BIGINT = 2,
        BOOLEAN = 3,
        SELECT = 4,
        SLIDER = 5,
        COMPONENT = 6,
        CUSTOM = 7
      }
      function definePluginSettings(settings: Record<string, unknown>) {
        return settings;
      }
      definePluginSettings({
        boolSetting: {
          type: OptionType.BOOLEAN,
          default: true
        },
        strSetting: {
          type: OptionType.STRING,
          default: "test"
        },
        intSetting: {
          type: OptionType.NUMBER,
          default: 42
        },
        floatSetting: {
          type: OptionType.NUMBER,
          default: 3.14
        }
      });`
    );
    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
    if (!callExpr) {
      throw new Error('Call expression not found');
    }
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromCall(callExpr, checker, program);
    const boolSetting = result.boolSetting;
    const strSetting = result.strSetting;
    const intSetting = result.intSetting;
    const floatSetting = result.floatSetting;
    if (boolSetting && 'default' in boolSetting) {
      expect(boolSetting.default).toBe(true);
    }
    if (strSetting && 'default' in strSetting) {
      expect(strSetting.default).toBe('test');
    }
    if (intSetting && 'default' in intSetting) {
      expect(intSetting.default).toBe(42);
    }
    if (floatSetting && 'default' in floatSetting) {
      expect(floatSetting.default).toBe(3.14);
    }
  });

  test('handles missing definePluginSettings call', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const x = 42;`);
    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
    if (!callExpr) {
      // No call expression, so we need to create one manually
      const result = extractSettingsFromCall(
        undefined as unknown as Parameters<typeof extractSettingsFromCall>[0],
        project.getTypeChecker(),
        project.getProgram()
      );
      expect(result).toEqual({});
      return;
    }
    // If it's not definePluginSettings, should return empty
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromCall(callExpr, checker, program);
    expect(result).toEqual({});
  });

  test('handles empty settings object', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `definePluginSettings({});`);
    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
    if (!callExpr) {
      throw new Error('Call expression not found');
    }
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromCall(callExpr, checker, program);
    expect(Object.keys(result)).toHaveLength(0);
  });

  test('treats empty settings object as a valid empty detailed result', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `definePluginSettings({});`);
    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
    if (!callExpr) {
      throw new Error('Call expression not found');
    }

    const result = extractSettingsFromCallDetailed(
      callExpr,
      project.getTypeChecker(),
      project.getProgram()
    );

    expect(result.items).toEqual({});
    expect(result.diagnostics).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.unsupported).toEqual([]);
  });

  test('reports unsupported generated settings patterns in detailed results', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const pairs = [["enabled", { type: OptionType.BOOLEAN, default: true }]];
       definePluginSettings(Object.fromEntries(pairs));`
    );
    const callExpr = sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((call) => call.getExpression().getText() === 'definePluginSettings');
    if (!callExpr) {
      throw new Error('Call expression not found');
    }

    const result = extractSettingsFromCallDetailed(
      callExpr,
      project.getTypeChecker(),
      project.getProgram()
    );

    expect(result.items).toEqual({});
    expect(result.unsupported).toMatchObject([{ kind: 'unsupported-generated-settings-pattern' }]);
    expect(result.diagnostics).toMatchObject([{ kind: 'unsupported-generated-settings-pattern' }]);
  });

  test('reports hidden settings as skipped detailed results', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `definePluginSettings({
        hiddenSetting: {
          type: OptionType.STRING,
          hidden: true,
        }
      });`
    );
    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
    if (!callExpr) {
      throw new Error('Call expression not found');
    }

    const result = extractSettingsFromCallDetailed(
      callExpr,
      project.getTypeChecker(),
      project.getProgram()
    );

    expect(result.items).toEqual({});
    expect(result.skipped).toMatchObject([
      { kind: 'hidden-setting-skipped', key: 'hiddenSetting' },
    ]);
    expect(result.diagnostics).toMatchObject([
      { kind: 'hidden-setting-skipped', key: 'hiddenSetting' },
    ]);
  });

  test('reports component-only settings as skipped detailed results', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.tsx',
      `definePluginSettings({
        preview: {
          type: OptionType.COMPONENT,
          component: PreviewComponent,
        }
      });`
    );
    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
    if (!callExpr) {
      throw new Error('Call expression not found');
    }

    const result = extractSettingsFromCallDetailed(
      callExpr,
      project.getTypeChecker(),
      project.getProgram()
    );

    expect(result.items).toEqual({});
    expect(result.skipped).toMatchObject([
      { kind: 'component-only-setting-skipped', key: 'preview' },
    ]);
    expect(result.diagnostics).toMatchObject([
      { kind: 'component-only-setting-skipped', key: 'preview' },
    ]);
  });

  test('extracts private settings from withPrivateSettings type literals', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.tsx',
      `export const enum OptionType {
        STRING = 0,
        NUMBER = 1,
        BIGINT = 2,
        BOOLEAN = 3,
        SELECT = 4,
        SLIDER = 5,
        COMPONENT = 6,
        CUSTOM = 7
      }
      export const enum ActivityType {
        PLAYING,
        STREAMING,
        LISTENING,
        WATCHING,
        CUSTOM_STATUS,
        COMPETING,
        HANG_STATUS
      }
      export const enum TimestampMode {
        NONE,
        NOW,
        TIME,
        CUSTOM
      }
      function definePluginSettings(settings: Record<string, unknown>) {
        return {
          ...settings,
          withPrivateSettings<T extends object>() {
            return this as typeof this & T;
          }
        };
      }
      const settings = definePluginSettings({
        config: {
          type: OptionType.COMPONENT,
          component: () => null
        },
      }).withPrivateSettings<{
        appID?: string;
        appName?: string;
        type?: ActivityType;
        timestampMode?: TimestampMode;
        startTime?: number;
        loop?: boolean;
        multiGreetChoices?: string[];
        nestedFolders: Record<string, string>;
        formats: {
          cozyFormat: string;
          compactFormat: string;
        };
      }>();`
    );
    const callExpr = findDefinePluginSettings(sourceFile);
    if (!callExpr) throw new Error('Call expression not found');
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromCall(callExpr, checker, program);

    expect(result.config).toBeUndefined();

    const appID = result.appID as PluginSetting;
    expect(appID.type).toBe('types.nullOr types.str');
    expect(appID.default).toBeNull();

    const type = result.type as PluginSetting;
    expect(type.type).toBe('types.enum');
    expect(type.enumValues).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(type.default).toBe(0);

    const timestampMode = result.timestampMode as PluginSetting;
    expect(timestampMode.enumValues).toEqual([0, 1, 2, 3]);

    const startTime = result.startTime as PluginSetting;
    expect(startTime.type).toBe('types.int');
    expect(startTime.default).toBe(0);

    const loop = result.loop as PluginSetting;
    expect(loop.type).toBe('types.bool');
    expect(loop.default).toBe(false);

    const multiGreetChoices = result.multiGreetChoices as PluginSetting;
    expect(multiGreetChoices.type).toBe('types.listOf types.str');
    expect(multiGreetChoices.default).toEqual([]);

    const nestedFolders = result.nestedFolders as PluginSetting;
    expect(nestedFolders.type).toBe('types.attrs');
    expect(nestedFolders.default).toEqual({});

    const formats = result.formats as PluginConfig;
    expect((formats.settings.cozyFormat as PluginSetting).type).toBe('types.nullOr types.str');
  });

  test('extracts known external enum private setting types without resolved imports', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `function definePluginSettings(settings: Record<string, unknown>) {
        return {
          ...settings,
          withPrivateSettings<T extends object>() {
            return this as typeof this & T;
          }
        };
      }
      const settings = definePluginSettings({}).withPrivateSettings<{
        type?: ActivityType;
      }>();`
    );
    const callExpr = findDefinePluginSettings(sourceFile);
    if (!callExpr) throw new Error('Call expression not found');
    const result = extractSettingsFromCall(
      callExpr,
      project.getTypeChecker(),
      project.getProgram()
    );

    const type = result.type as PluginSetting;
    expect(type.type).toBe('types.enum');
    expect(type.enumValues).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(type.default).toBe(0);
  });

  test('handles missing arguments', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `definePluginSettings();`);
    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
    if (!callExpr) {
      throw new Error('Call expression not found');
    }
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromCall(callExpr, checker, program);
    expect(result).toEqual({});
  });

  test('handles placeholder property', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `definePluginSettings({
        setting: {
          type: OptionType.STRING,
          placeholder: "Enter value"
        }
      });`
    );
    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
    if (!callExpr) {
      throw new Error('Call expression not found');
    }
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromCall(callExpr, checker, program);
    const setting = result.setting;
    if (setting && 'example' in setting) {
      expect(setting.example).toBe('Enter value');
    }
  });

  test('uses name as description fallback', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `export const enum OptionType {
        STRING = 0,
        NUMBER = 1,
        BIGINT = 2,
        BOOLEAN = 3,
        SELECT = 4,
        SLIDER = 5,
        COMPONENT = 6,
        CUSTOM = 7
      }
      function definePluginSettings(settings: Record<string, unknown>) {
        return settings;
      }
      definePluginSettings({
        setting: {
          type: OptionType.STRING,
          name: "Setting Name"
        }
      });`
    );
    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
    if (!callExpr) {
      throw new Error('Call expression not found');
    }
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromCall(callExpr, checker, program);
    const setting = result.setting;
    if (setting && 'description' in setting) {
      expect(setting.description).toBe('Setting Name');
    }
  });

  test('handles computed defaults with getters (like vcNarrator pattern)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `export const enum OptionType {
        STRING = 0,
        NUMBER = 1,
        BIGINT = 2,
        BOOLEAN = 3,
        SELECT = 4,
        SLIDER = 5,
        COMPONENT = 6,
        CUSTOM = 7
      }
      function definePluginSettings(settings: Record<string, unknown>) {
        return settings;
      }
      const getDefaultVoice = () => ({ voiceURI: "default-voice" });
      definePluginSettings({
        voice: {
          type: OptionType.COMPONENT,
          component: () => null,
          get default() {
            return getDefaultVoice()?.voiceURI;
          }
        },
        volume: {
          type: OptionType.SLIDER,
          description: "Volume",
          default: 1
        }
      });`
    );
    const callExpr = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
    if (!callExpr) {
      throw new Error('Call expression not found');
    }
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromCall(callExpr, checker, program);

    // Computed defaults are represented as nullable (we can't execute getters)
    const voice = result.voice;
    expect(voice).toBeDefined();
    if (voice && 'default' in voice) {
      expect(voice.default).toBeNull();
    }

    // Regular defaults should work
    const volume = result.volume;
    expect(volume).toBeDefined();
    if (volume && 'default' in volume) {
      expect(volume.default).toBe(1);
    }
    if (volume && 'type' in volume) {
      expect(volume.type).toBe('types.float');
    }
  });

  test('extracts settings from Object.entries().map() spreads', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `export const enum OptionType {
        STRING = 0,
        NUMBER = 1,
        BIGINT = 2,
        BOOLEAN = 3,
        SELECT = 4,
        SLIDER = 5,
        COMPONENT = 6,
        CUSTOM = 7
      }
      function definePluginSettings(settings: Record<string, unknown>) {
        return settings;
      }
      const indicatorLocations = {
        list: { description: "In the member list" },
        badges: { description: "In user profiles, as badges" },
        messages: { description: "Inside messages" }
      };
      definePluginSettings({
        ...Object.fromEntries(
          Object.entries(indicatorLocations).map(([key, value]) => {
            return [key, {
              type: OptionType.BOOLEAN,
              description: \`Show indicators \${value.description.toLowerCase()}\`,
              restartNeeded: true,
              default: true
            }];
          })
        ),
        colorMobileIndicator: {
          type: OptionType.BOOLEAN,
          description: "Whether to make the mobile indicator match the color of the user status.",
          default: true
        }
      });`
    );
    const callExpr = findDefinePluginSettings(sourceFile);
    if (!callExpr) throw new Error('Call expression not found');

    const result = extractSettingsFromCall(
      callExpr,
      project.getTypeChecker(),
      project.getProgram()
    );
    expect(result.list).toMatchObject({
      name: 'list',
      type: 'types.bool',
      default: true,
      description: 'Show indicators in the member list (restart required)',
    });
    expect(result.badges).toBeDefined();
    expect(result.messages).toBeDefined();
    expect(result.colorMobileIndicator).toBeDefined();
  });

  test('extracts reducer-generated settings from direct object literals', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `export const enum OptionType {
        STRING = 0,
        NUMBER = 1,
        BIGINT = 2,
        BOOLEAN = 3,
        SELECT = 4,
        SLIDER = 5,
        COMPONENT = 6,
        CUSTOM = 7
      }
      function definePluginSettings(settings: Record<string, unknown>) {
        return settings;
      }
      definePluginSettings(
        Object.entries({
          spotify: { description: "Open Spotify links in app" },
          steam: { description: "Open Steam links in app" }
        }).reduce((acc, [key, rule]) => {
          acc[key] = {
            type: OptionType.BOOLEAN,
            description: rule.description,
            default: true
          };
          return acc;
        }, {} as Record<string, unknown>)
      );`
    );
    const callExpr = findDefinePluginSettings(sourceFile);
    if (!callExpr) throw new Error('Call expression not found');

    const result = extractSettingsFromCall(
      callExpr,
      project.getTypeChecker(),
      project.getProgram()
    );
    expect(result.spotify).toMatchObject({
      name: 'spotify',
      type: 'types.bool',
      default: true,
      description: 'Open Spotify links in app',
    });
    expect(result.steam).toBeDefined();
  });

  test('filters hidden reducer-generated settings unless explicitly skipped', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `export const enum OptionType {
        STRING = 0,
        NUMBER = 1,
        BIGINT = 2,
        BOOLEAN = 3,
        SELECT = 4,
        SLIDER = 5,
        COMPONENT = 6,
        CUSTOM = 7
      }
      function definePluginSettings(settings: Record<string, unknown>) {
        return settings;
      }
      const generated = Object.entries({
        spotify: { description: "Open Spotify links in app" }
      }).reduce((acc, [key, rule]) => {
        acc[key] = {
          type: OptionType.BOOLEAN,
          description: rule.description,
          default: true,
          hidden: true
        };
        return acc;
      }, {} as Record<string, unknown>);
      definePluginSettings(generated);`
    );
    const callExpr = findDefinePluginSettings(sourceFile);
    if (!callExpr) throw new Error('Call expression not found');

    expect(
      extractSettingsFromCall(callExpr, project.getTypeChecker(), project.getProgram()).spotify
    ).toBeUndefined();
    expect(
      extractSettingsFromCall(callExpr, project.getTypeChecker(), project.getProgram(), true)
        .spotify
    ).toBeDefined();
  });

  test('extracts settings from array map spreads with JSON.stringify defaults', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `export const enum OptionType {
        STRING = 0,
        NUMBER = 1,
        BIGINT = 2,
        BOOLEAN = 3,
        SELECT = 4,
        SLIDER = 5,
        COMPONENT = 6,
        CUSTOM = 7
      }
      function definePluginSettings(settings: Record<string, unknown>) {
        return settings;
      }
      const soundTypes = [
        { name: "Call Calling", id: "call_calling" },
        { name: "Mute", id: "mute" }
      ] as const;
      const allSoundTypes = soundTypes || [];
      function makeEmptyOverride() {
        return {
          enabled: false,
          selectedSound: "default",
          volume: 100,
          useFile: false,
          selectedFileId: undefined
        };
      }
      const soundSettings = Object.fromEntries(
        allSoundTypes.map(type => [
          type.id,
          {
            type: OptionType.STRING,
            description: \`Override for \${type.name}\`,
            default: JSON.stringify(makeEmptyOverride()),
            hidden: true
          }
        ])
      );
      definePluginSettings({
        ...soundSettings,
        overrides: {
          type: OptionType.COMPONENT,
          component: () => null
        }
      });`
    );
    const callExpr = findDefinePluginSettings(sourceFile);
    if (!callExpr) throw new Error('Call expression not found');

    const result = extractSettingsFromCall(
      callExpr,
      project.getTypeChecker(),
      project.getProgram(),
      true
    );
    expect(result.call_calling).toMatchObject({
      name: 'call_calling',
      type: 'types.str',
      description: 'Override for Call Calling',
      default: '{"enabled":false,"selectedSound":"default","volume":100,"useFile":false}',
    });
    expect(result.mute).toBeDefined();
    expect(result.overrides).toBeUndefined();
  });

  test('classifies component defaults from conditional string-array constants', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.tsx',
      `export const enum OptionType {
        STRING = 0,
        NUMBER = 1,
        BIGINT = 2,
        BOOLEAN = 3,
        SELECT = 4,
        SLIDER = 5,
        COMPONENT = 6,
        CUSTOM = 7
      }
      const IS_MAC = false;
      function definePluginSettings(settings: Record<string, unknown>) {
        return settings;
      }
      const DEFAULT_KEYS = IS_MAC ? ["Meta", "Shift", "P"] : ["Control", "Shift", "P"];
      definePluginSettings({
        hotkey: {
          type: OptionType.COMPONENT,
          default: DEFAULT_KEYS,
          component: () => null
        }
      });`
    );
    const callExpr = findDefinePluginSettings(sourceFile);
    if (!callExpr) throw new Error('Call expression not found');

    const result = extractSettingsFromCall(
      callExpr,
      project.getTypeChecker(),
      project.getProgram()
    );
    expect(result.hotkey).toMatchObject({
      name: 'hotkey',
      type: 'types.listOf types.str',
      default: [],
    });
  });

  test('extracts store-backed bare component settings', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.tsx',
      `export const enum OptionType {
        STRING = 0,
        NUMBER = 1,
        BIGINT = 2,
        BOOLEAN = 3,
        SELECT = 4,
        SLIDER = 5,
        COMPONENT = 6,
        CUSTOM = 7
      }
      function definePluginSettings(settings: Record<string, unknown>) {
        return settings;
      }
      function SoundIdInput() {
        const { soundId } = settings.use(["soundId"]);
        return <TextInput value={soundId} onChange={v => settings.store.soundId = v} />;
      }
      const settings = definePluginSettings({
        soundId: {
          type: OptionType.COMPONENT,
          description: "Enter the ID of the sound you want to play.",
          component: SoundIdInput
        },
        scanQr: {
          type: OptionType.COMPONENT,
          description: "Scan a QR code",
          component: () => <Button />
        }
      });`
    );
    const callExpr = findDefinePluginSettings(sourceFile);
    if (!callExpr) throw new Error('Call expression not found');

    const result = extractSettingsFromCall(
      callExpr,
      project.getTypeChecker(),
      project.getProgram()
    );
    expect(result.soundId).toMatchObject({
      name: 'soundId',
      type: 'types.nullOr types.str',
      default: null,
      description: 'Enter the ID of the sound you want to play.',
    });
    expect(result.scanQr).toBeUndefined();
  });

  test('extracts structured settings from array-backed component stores', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.tsx',
      `export const enum OptionType {
        STRING = 0,
        NUMBER = 1,
        BIGINT = 2,
        BOOLEAN = 3,
        SELECT = 4,
        SLIDER = 5,
        COMPONENT = 6,
        CUSTOM = 7
      }
      function definePluginSettings(settings: Record<string, unknown>) {
        return settings;
      }
      const tags = [
        {
          name: "WEBHOOK",
          displayName: "Webhook",
          description: "Messages sent by webhooks"
        },
        {
          name: "MODERATOR_STAFF",
          displayName: "Staff",
          description: "Can manage the server, channels or roles"
        }
      ] as const;
      function SettingsComponent() {
        const tagSettings = (settings.store.tagSettings ??= {});
        tags.forEach(t => {
          if (!tagSettings[t.name]) {
            tagSettings[t.name] = {
              text: t.displayName,
              showInChat: true,
              showInNotChat: true
            };
          }
        });
        return <div />;
      }
      const settings = definePluginSettings({
        tagSettings: {
          type: OptionType.COMPONENT,
          component: SettingsComponent,
          description: "fill me"
        }
      });`
    );
    const callExpr = findDefinePluginSettings(sourceFile);
    if (!callExpr) throw new Error('Call expression not found');

    const result = extractSettingsFromCall(
      callExpr,
      project.getTypeChecker(),
      project.getProgram()
    );
    expect(result.tagSettings).toMatchObject({
      name: 'tagSettings',
      settings: {
        WEBHOOK: {
          name: 'WEBHOOK',
          settings: {
            text: {
              name: 'text',
              type: 'types.str',
              default: 'Webhook',
              description: 'Text for Webhook tag',
            },
            showInChat: {
              name: 'showInChat',
              type: 'types.bool',
              default: true,
              description: 'Show Webhook tag in messages',
            },
            showInNotChat: {
              name: 'showInNotChat',
              type: 'types.bool',
              default: true,
              description: 'Show Webhook tag in member list and profiles',
            },
          },
        },
        MODERATOR_STAFF: {
          name: 'MODERATOR_STAFF',
          settings: {
            text: {
              name: 'text',
              type: 'types.str',
              default: 'Staff',
              description: 'Text for Staff tag',
            },
          },
        },
      },
    });
  });

  test('extracts store-backed component settings through rendered child components', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.tsx',
      `export const enum OptionType {
        STRING = 0,
        NUMBER = 1,
        BIGINT = 2,
        BOOLEAN = 3,
        SELECT = 4,
        SLIDER = 5,
        COMPONENT = 6,
        CUSTOM = 7
      }
      function definePluginSettings(settings: Record<string, unknown>) {
        return settings;
      }
      function Picker() {
        const { streamMedia } = settings.use(["streamMedia"]);
        return <SearchableSelect value={streamMedia} onChange={v => settings.store.streamMedia = v} />;
      }
      function SettingSection() {
        return <Picker />;
      }
      const settings = definePluginSettings({
        streamMedia: {
          type: OptionType.COMPONENT,
          component: SettingSection,
        }
      });`
    );
    const callExpr = findDefinePluginSettings(sourceFile);
    if (!callExpr) throw new Error('Call expression not found');

    const result = extractSettingsFromCall(
      callExpr,
      project.getTypeChecker(),
      project.getProgram()
    );
    expect(result.streamMedia).toMatchObject({
      name: 'streamMedia',
      type: 'types.nullOr types.str',
      default: null,
    });
  });

  test('extracts store-backed component settings through wrapped factory components', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.tsx',
      `export const enum OptionType {
        STRING = 0,
        NUMBER = 1,
        BIGINT = 2,
        BOOLEAN = 3,
        SELECT = 4,
        SLIDER = 5,
        COMPONENT = 6,
        CUSTOM = 7
      }
      function definePluginSettings(settings: Record<string, unknown>) {
        return settings;
      }
      const ErrorBoundary = { wrap: component => component };
      function createDirSelector(settingKey: "logsDir" | "imageCacheDir", successMessage: string) {
        return function DirSelector() {
          return <FolderInput settingsKey={settingKey} successMessage={successMessage} />;
        };
      }
      const ImageCacheDir = createDirSelector("imageCacheDir", "Successfully updated Image Cache Dir");
      function FolderInput({ settingsKey, successMessage }) {
        const path = settings.store[settingsKey];
        return <Button onClick={() => { settings.store[settingsKey] = successMessage; }}>{path}</Button>;
      }
      const settings = definePluginSettings({
        imageCacheDir: {
          type: OptionType.COMPONENT,
          description: "Select saved images directory",
          component: ErrorBoundary.wrap(ImageCacheDir) as any
        }
      });`
    );
    const callExpr = findDefinePluginSettings(sourceFile);
    if (!callExpr) throw new Error('Call expression not found');

    const result = extractSettingsFromCall(
      callExpr,
      project.getTypeChecker(),
      project.getProgram()
    );
    expect(result.imageCacheDir).toMatchObject({
      name: 'imageCacheDir',
      type: 'types.nullOr types.str',
      default: null,
      description: 'Select saved images directory',
    });
  });
});
