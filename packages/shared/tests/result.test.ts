import { describe, test, expect } from 'vitest';
import { Ok, Err, isOk, isErr, map, flatMap, unwrapOr } from '../src/result.js';

describe('Result utilities', () => {
  const ok = Ok(42);
  const err = Err('fail');

  describe('isOk', () => {
    test('returns true for Ok', () => expect(isOk(ok)).toBe(true));
    test('returns false for Err', () => expect(isOk(err)).toBe(false));
  });

  describe('isErr', () => {
    test('returns true for Err', () => expect(isErr(err)).toBe(true));
    test('returns false for Ok', () => expect(isErr(ok)).toBe(false));
  });

  describe('map', () => {
    test('transforms Ok value', () => {
      const result = map(ok, (v) => v * 2);
      expect(result).toEqual(Ok(84));
    });

    test('passes through Err unchanged', () => {
      const result = map(err, () => 999);
      expect(result).toEqual(err);
    });
  });

  describe('flatMap', () => {
    test('chains Ok results', () => {
      const result = flatMap(ok, (v) => Ok(String(v)));
      expect(result).toEqual(Ok('42'));
    });

    test('chains Ok to Err', () => {
      const result = flatMap(ok, () => Err('chained error'));
      expect(result).toEqual(Err('chained error'));
    });

    test('passes through Err unchanged', () => {
      const result = flatMap(err, () => Ok(999));
      expect(result).toEqual(err);
    });
  });

  describe('unwrapOr', () => {
    test('returns value for Ok', () => expect(unwrapOr(ok, 0)).toBe(42));
    test('returns fallback for Err', () => expect(unwrapOr(err, 0)).toBe(0));
  });
});
