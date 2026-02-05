import { describe, test, expect } from 'vitest';
import { NixGenerator, type NixRaw, type NixAttrSet } from '../src/generator-base.js';

describe('NixGenerator', () => {
  describe('identifier()', () => {
    const gen = new NixGenerator();

    test('converts to camelCase', () => {
      expect(gen.identifier('test-setting')).toBe('testSetting');
      expect(gen.identifier('test_setting')).toBe('testSetting');
      expect(gen.identifier('Test Setting')).toBe('testSetting');
    });

    test('preserves acronym casing', () => {
      expect(gen.identifier('ListenBrainzRPC')).toBe('ListenBrainzRPC');
      expect(gen.identifier('TosuRPC')).toBe('TosuRPC');
      expect(gen.identifier('TiktokTTS')).toBe('TiktokTTS');
      expect(gen.identifier('AmITyping')).toBe('AmITyping');
      expect(gen.identifier('AlwaysExpandProfiles')).toBe('alwaysExpandProfiles');
      expect(gen.identifier('BetterPlusReacts')).toBe('betterPlusReacts');
      expect(gen.identifier('AudioBookShelfRichPresence')).toBe('audioBookShelfRichPresence');
    });

    test('handles special characters', () => {
      expect(gen.identifier('test-setting-name')).toBe('testSettingName');
      expect(gen.identifier('test_setting_name')).toBe('testSettingName');
      expect(gen.identifier('test (restart required)')).toBe('test');
    });

    test('handles invalid identifiers', () => {
      expect(gen.identifier('123invalid')).toBe('_123invalid');
      expect(gen.identifier('-invalid')).toBe('_invalid');
      expect(gen.identifier('')).toBe('_');
      expect(gen.identifier('!@#$%')).toBe('_');
    });

    test('removes parenthetical content', () => {
      expect(gen.identifier('setting (restart required)')).toBe('setting');
      expect(gen.identifier('name (optional)')).toBe('name');
    });

    test('collapses multiple underscores', () => {
      expect(gen.identifier('test___setting')).toBe('testSetting');
      expect(gen.identifier('__test__')).toBe('test');
    });

    test('preserves valid identifiers', () => {
      expect(gen.identifier('test')).toBe('test');
      expect(gen.identifier('testSetting')).toBe('testSetting');
      expect(gen.identifier('_private')).toBe('_private');
    });
  });

  describe('string()', () => {
    const gen = new NixGenerator();

    test('multiline string generation', () => {
      const result = gen.string('line1\nline2', true);
      expect(result).toContain("''");
      expect(result).toMatch(/''[\s\S]*''/);
    });

    test('double-quoted string generation', () => {
      const result = gen.string('simple text');
      expect(result).toBe('"simple text"');
    });

    test('handles quotes in strings', () => {
      const result = gen.string('Say "hello"');
      expect(result).toBe('"Say \\"hello\\""');
    });

    test('handles special characters', () => {
      const result = gen.string('$value');
      expect(result).toBe('"$value"');
      const result2 = gen.string('${interpolation}');
      expect(result2).toBe('"\\${interpolation}"');
    });

    test('automatically uses multiline for newlines', () => {
      const result = gen.string('line1\nline2');
      expect(result).toContain("''");
    });

    test('handles empty strings', () => {
      expect(gen.string('')).toBe('""');
    });
  });

  describe('value()', () => {
    const gen = new NixGenerator();

    test('string values', () => {
      expect(gen.value('test')).toBe('"test"');
    });

    test('number values (int)', () => {
      expect(gen.value(42)).toBe('42');
      expect(gen.value(0)).toBe('0');
      expect(gen.value(-10)).toBe('-10');
    });

    test('number values (float)', () => {
      expect(gen.value(3.14)).toBe('3.14');
      expect(gen.value(0.5)).toBe('0.5');
      expect(gen.value(-1.5)).toBe('-1.5');
    });

    test('boolean values', () => {
      expect(gen.value(true)).toBe('true');
      expect(gen.value(false)).toBe('false');
    });

    test('null values', () => {
      expect(gen.value(null)).toBe('null');
    });

    test('array values', () => {
      const result = gen.value([1, 2, 3]);
      expect(result).toContain('[');
      expect(result).toContain(']');
      expect(result).toContain('1');
      expect(result).toContain('2');
      expect(result).toContain('3');
    });

    test('object/AttrSet values', () => {
      const obj: NixAttrSet = { key: 'value', num: 42 };
      const result = gen.value(obj);
      expect(result).toContain('{');
      expect(result).toContain('}');
      expect(result).toContain('key');
      expect(result).toContain('value');
    });

    test('nested structures', () => {
      const nested: NixAttrSet = {
        nested: {
          deep: {
            value: 'test',
          },
        },
      };
      const result = gen.value(nested);
      expect(result).toContain('nested');
      expect(result).toContain('deep');
      expect(result).toContain('value');
    });

    test('raw values', () => {
      const raw: NixRaw = { type: 'raw', value: 'types.bool' };
      expect(gen.value(raw)).toBe('types.bool');
    });

    test('mixed arrays', () => {
      const mixed = ['string', 42, true, null];
      const result = gen.value(mixed);
      expect(result).toContain('"string"');
      expect(result).toContain('42');
      expect(result).toContain('true');
      expect(result).toContain('null');
    });
  });

  describe('attrSet()', () => {
    const gen = new NixGenerator();

    test('formats correctly', () => {
      const attrs: NixAttrSet = { key: 'value' };
      const result = gen.attrSet(attrs);
      expect(result).toContain('{');
      expect(result).toContain('}');
      expect(result).toContain('key');
      expect(result).toContain('value');
    });

    test('sorts keys alphabetically', () => {
      const attrs: NixAttrSet = { zebra: 'z', alpha: 'a', beta: 'b' };
      const result = gen.attrSet(attrs);
      const alphaPos = result.indexOf('alpha');
      const betaPos = result.indexOf('beta');
      const zebraPos = result.indexOf('zebra');
      expect(alphaPos).toBeLessThan(betaPos);
      expect(betaPos).toBeLessThan(zebraPos);
    });

    test('filters undefined values', () => {
      const attrs: NixAttrSet = {
        defined: 'value',
        undefined: undefined,
      };
      const result = gen.attrSet(attrs);
      expect(result).toContain('defined');
      expect(result).not.toContain('undefined');
    });

    test('handles empty attrset', () => {
      const result = gen.attrSet({});
      expect(result).toBe('{ }');
    });

    test('handles nested attrsets', () => {
      const attrs: NixAttrSet = {
        outer: {
          inner: 'value',
        },
      };
      const result = gen.attrSet(attrs);
      expect(result).toContain('outer');
      expect(result).toContain('inner');
    });

    test('proper indentation', () => {
      const attrs: NixAttrSet = {
        key: 'value',
        nested: {
          deep: 'value',
        },
      };
      const result = gen.attrSet(attrs);
      // Check that nested content is indented
      expect(result).toMatch(/nested[\s\S]*deep/);
    });

    test('handles array values in attrsets', () => {
      const attrs: NixAttrSet = {
        items: [1, 2, 3],
      };
      const result = gen.attrSet(attrs);
      expect(result).toContain('items');
      expect(result).toContain('[');
    });
  });

  describe('list()', () => {
    const gen = new NixGenerator();

    test('formats list correctly', () => {
      const result = gen.list([1, 2, 3]);
      expect(result).toContain('[');
      expect(result).toContain(']');
      expect(result).toContain('1');
      expect(result).toContain('2');
      expect(result).toContain('3');
    });

    test('handles empty list', () => {
      expect(gen.list([])).toBe('[ ]');
    });

    test('handles mixed types', () => {
      const result = gen.list(['string', 42, true]);
      expect(result).toContain('"string"');
      expect(result).toContain('42');
      expect(result).toContain('true');
    });

    test('proper indentation', () => {
      const result = gen.list([1, 2], 1);
      expect(result).toContain('[');
      expect(result).toContain(']');
    });
  });

  describe('raw()', () => {
    const gen = new NixGenerator();

    test('creates raw Nix expression', () => {
      const raw = gen.raw('types.bool');
      expect(raw).toEqual({ type: 'raw', value: 'types.bool' });
    });

    test('raw value can be used in value()', () => {
      const raw = gen.raw('types.str');
      const result = gen.value(raw);
      expect(result).toBe('types.str');
    });
  });

  describe('number()', () => {
    const gen = new NixGenerator();

    test('formats numbers correctly (int and float)', () => {
      expect(gen.number(0)).toBe('0');
      expect(gen.number(42)).toBe('42');
      expect(gen.number(-10)).toBe('-10');
      expect(gen.number(3.14)).toBe('3.14');
      expect(gen.number(-0.5)).toBe('-0.5');
    });
  });

  describe('boolean() and nullValue()', () => {
    const gen = new NixGenerator();

    test('formats primitives correctly', () => {
      expect(gen.boolean(true)).toBe('true');
      expect(gen.boolean(false)).toBe('false');
      expect(gen.nullValue()).toBe('null');
    });
  });

  describe('custom indent', () => {
    test('uses custom indent', () => {
      const gen = new NixGenerator({ indent: '    ' });
      const attrs: NixAttrSet = { key: 'value' };
      const result = gen.attrSet(attrs);
      // Should use 4 spaces instead of 2
      expect(result).toContain('    key');
    });
  });
});
