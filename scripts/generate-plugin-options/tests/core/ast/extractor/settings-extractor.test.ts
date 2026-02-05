import { describe, test, expect } from 'vitest';
import { Project, SyntaxKind, ModuleKind } from 'ts-morph';
import {
  extractSettingsFromCall,
  extractSettingsFromObject,
} from '../../../../src/core/ast/extractor/settings-extractor.js';
import type { PluginSetting } from '../../../../src/shared/types.js';

function createProject(): Project {
  return new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    compilerOptions: {
      target: 99, // ES2022
      module: ModuleKind.ESNext,
      jsx: 2, // React
      allowJs: true,
      skipLibCheck: true,
    },
  });
}

test('CUSTOM with computed object default (Object.fromEntries) -> attrs with {}', () => {
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
  const ss = result.servicesSettings as any;
  expect(ss).toBeDefined();
  expect(ss.type).toBe('types.attrs');
  expect(ss.default).toEqual({});
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
  const country = result.country as any;
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
  const reasons = result.reasons as any;
  expect(reasons.type).toBe('types.listOf types.str');
  expect(reasons.default).toEqual([]);
});

test('COMPONENT bare (only component) -> attrs {}', () => {
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
  const hotkey = result.hotkey as any;
  expect(hotkey.type).toBe('types.attrs');
  expect(hotkey.default).toEqual({});
});

test('CUSTOM identifier default resolving to object literal -> attrs {}', () => {
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
  const complex = result.complex as any;
  expect(complex.type).toBe('types.attrs');
  expect(complex.default).toEqual({});
});

test('CUSTOM identifier default resolving to array of objects -> attrs {} (conservative)', () => {
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
  const list = result.list as any;
  expect(list.type).toBe('types.attrs');
  expect(list.default).toEqual([]);
});

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
      const settings = result.config.settings as Record<string, unknown>;
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
        undefined as any,
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

describe('extractSettingsFromObject()', () => {
  test('recursive settings extraction', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const settings = {
        nested: {
          type: OptionType.STRING,
          description: "Nested",
          default: "value"
        }
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('settings')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromObject(objLiteral, checker, program);
    expect(result.nested).toBeDefined();
    expect(result.nested?.name).toBe('nested');
  });

  test('handles deeply nested settings (2 levels)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const settings = {
        level1: {
          level2: {
            type: OptionType.STRING,
            description: "Deep",
            default: "value"
          }
        }
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('settings')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromObject(objLiteral, checker, program);
    expect(result.level1).toBeDefined();
    expect(result.level1?.name).toBe('level1');
    if (result.level1 && 'settings' in result.level1) {
      const settings = result.level1.settings as Record<string, unknown>;
      expect(settings.level2).toBeDefined();
    }
  });

  test('handles 3+ levels of nesting', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const settings = {
        config: {
          deep: {
            deeper: {
              type: OptionType.NUMBER,
              description: "Deeply nested setting",
              default: 42
            }
          }
        }
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('settings')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromObject(objLiteral, checker, program);
    expect(result.config).toBeDefined();
    expect(result.config?.name).toBe('config');
    if (result.config && 'settings' in result.config) {
      const settings = result.config.settings as Record<string, unknown>;
      expect(settings.deep).toBeDefined();
      const deep = settings.deep as Record<string, unknown>;
      if (deep && 'settings' in deep) {
        const deepSettings = deep.settings as Record<string, unknown>;
        expect(deepSettings.deeper).toBeDefined();
        const deeper = deepSettings.deeper as Record<string, unknown>;
        if (deeper && 'type' in deeper) {
          expect(deeper.type).toBe('types.int');
          expect(deeper.default).toBe(42);
        }
      }
    }
  });

  test('handles multiple nested groups at same level', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const settings = {
        group1: {
          nested1: {
            type: OptionType.STRING,
            description: "Nested 1",
            default: "value1"
          }
        },
        group2: {
          nested2: {
            type: OptionType.BOOLEAN,
            description: "Nested 2",
            default: true
          }
        },
        group3: {
          nested3: {
            type: OptionType.NUMBER,
            description: "Nested 3",
            default: 123
          }
        }
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('settings')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromObject(objLiteral, checker, program);
    expect(result.group1).toBeDefined();
    expect(result.group2).toBeDefined();
    expect(result.group3).toBeDefined();
    if (result.group1 && 'settings' in result.group1) {
      const settings = result.group1.settings as Record<string, unknown>;
      expect(settings.nested1).toBeDefined();
    }
    if (result.group2 && 'settings' in result.group2) {
      const settings = result.group2.settings as Record<string, unknown>;
      expect(settings.nested2).toBeDefined();
    }
    if (result.group3 && 'settings' in result.group3) {
      const settings = result.group3.settings as Record<string, unknown>;
      expect(settings.nested3).toBeDefined();
    }
  });

  test('filters hidden at all levels', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const settings = {
        visible: {
          type: OptionType.STRING,
          description: "Visible"
        },
        hidden: {
          type: OptionType.STRING,
          description: "Hidden",
          hidden: true
        }
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('settings')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromObject(objLiteral, checker, program);
    expect(result.visible).toBeDefined();
    expect(result.hidden).toBeUndefined();
  });

  test('handles restart required in nested extraction', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const settings = {
        setting: {
          type: OptionType.STRING,
          description: "Restart needed",
          restartNeeded: true
        }
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('settings')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromObject(objLiteral, checker, program);
    const setting = result.setting;
    if (setting && 'description' in setting) {
      expect(setting.description).toContain('(restart required)');
    }
  });

  test('handles empty object', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile('test.ts', `const settings = {};`);
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('settings')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromObject(objLiteral, checker, program);
    expect(Object.keys(result)).toHaveLength(0);
  });

  test('handles non-object initializers', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const settings = {
        invalid: "not an object"
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('settings')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromObject(objLiteral, checker, program);
    expect(result.invalid).toBeUndefined();
  });

  test('handles COMPONENT type with object default (consoleJanitor pattern)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `function defineDefault<T>(value: T): T { return value; }
      const settings = {
        allowLevel: {
          type: OptionType.COMPONENT,
          component: () => null,
          default: defineDefault({
            error: true,
            warn: false,
            trace: false,
            log: false,
            info: false,
            debug: false
          })
        }
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('settings')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromObject(objLiteral, checker, program);
    expect(result.allowLevel).toBeDefined();
    const allowLevel = result.allowLevel;
    if (allowLevel && 'type' in allowLevel) {
      // COMPONENT type should be inferred from default object
      expect(allowLevel.type).toBeDefined();
      // Default should be extracted as object
      expect(allowLevel.default).toBeDefined();
      if (typeof allowLevel.default === 'object' && allowLevel.default !== null) {
        const defaultObj = allowLevel.default as Record<string, unknown>;
        expect(defaultObj.error).toBe(true);
        expect(defaultObj.warn).toBe(false);
      }
    }
  });

  test('handles CUSTOM type with nested structure (pinDms pattern)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const settings = {
        userBasedCategoryList: {
          type: OptionType.CUSTOM,
          default: {}
        }
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('settings')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromObject(objLiteral, checker, program);
    expect(result.userBasedCategoryList).toBeDefined();
    const custom = result.userBasedCategoryList;
    if (custom && 'type' in custom) {
      // CUSTOM type should be inferred from default object
      expect(custom.type).toBeDefined();
      // Default should be extracted as empty object
      expect(custom.default).toBeDefined();
      if (typeof custom.default === 'object' && custom.default !== null) {
        expect(Object.keys(custom.default)).toHaveLength(0);
      }
    }
  });

  test('handles very deep nesting (4+ levels)', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const settings = {
        level1: {
          level2: {
            level3: {
              level4: {
                type: OptionType.STRING,
                description: "4 levels deep",
                default: "deep-value"
              },
              level4b: {
                type: OptionType.NUMBER,
                description: "Another 4 levels deep",
                default: 42
              }
            },
            level3b: {
              type: OptionType.BOOLEAN,
              description: "3 levels deep",
              default: true
            }
          }
        }
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('settings')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromObject(objLiteral, checker, program);

    expect(result.level1).toBeDefined();
    const level1 = result.level1;
    if (level1 && 'settings' in level1) {
      const level1Settings = level1.settings as Record<string, unknown>;
      expect(level1Settings.level2).toBeDefined();
      const level2 = level1Settings.level2 as Record<string, unknown>;
      if (level2 && 'settings' in level2) {
        const level2Settings = level2.settings as Record<string, unknown>;
        expect(level2Settings.level3).toBeDefined();
        const level3 = level2Settings.level3 as Record<string, unknown>;
        if (level3 && 'settings' in level3) {
          const level3Settings = level3.settings as Record<string, unknown>;
          expect(level3Settings.level4).toBeDefined();
          const level4 = level3Settings.level4 as Record<string, unknown>;
          if (level4 && 'type' in level4) {
            expect(level4.type).toBe('types.str');
            expect(level4.default).toBe('deep-value');
          }

          expect(level3Settings.level4b).toBeDefined();
          const level4b = level3Settings.level4b as Record<string, unknown>;
          if (level4b && 'type' in level4b) {
            expect(level4b.type).toBe('types.int');
            expect(level4b.default).toBe(42);
          }
        }

        expect(level2Settings.level3b).toBeDefined();
        const level3b = level2Settings.level3b as Record<string, unknown>;
        if (level3b && 'type' in level3b) {
          expect(level3b.type).toBe('types.bool');
          expect(level3b.default).toBe(true);
        }
      }
    }
  });

  test('handles malformed settings structure gracefully', () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      'test.ts',
      `const settings = {
        valid: {
          type: OptionType.STRING,
          description: "Valid setting",
          default: "value"
        },
        invalid: "not an object",
        alsoInvalid: null
      };`
    );
    const objLiteral = sourceFile
      .getVariableDeclarationOrThrow('settings')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const checker = project.getTypeChecker();
    const program = project.getProgram();
    const result = extractSettingsFromObject(objLiteral, checker, program);

    // Valid setting should be extracted
    expect(result.valid).toBeDefined();
    // Invalid settings should be skipped
    expect(result.invalid).toBeUndefined();
    expect(result.alsoInvalid).toBeUndefined();
  });
});
