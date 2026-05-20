import type { PluginConfig, PluginSetting } from '@nixcord/shared';
import { SyntaxKind } from 'ts-morph';
import { describe, expect, test } from 'vitest';
import { extractSettingsFromCall } from '../../../../../src/extractor/settings-extractor.js';
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
});
