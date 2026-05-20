import { describe, expect, test } from 'vitest';
import {
  collect,
  Err,
  flatMap,
  fromNullable,
  fromPredicate,
  isErr,
  isOk,
  map,
  mapError,
  Ok,
  unwrapOr,
} from '../src/result.js';

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

  describe('fromNullable', () => {
    test('returns Ok for non-null value', () => {
      expect(fromNullable(42, () => 'was null')).toEqual(Ok(42));
    });
    test('returns Ok for falsy non-null value', () => {
      expect(fromNullable(0, () => 'was null')).toEqual(Ok(0));
      expect(fromNullable('', () => 'was null')).toEqual(Ok(''));
      expect(fromNullable(false, () => 'was null')).toEqual(Ok(false));
    });
    test('returns Err for null', () => {
      expect(fromNullable(null, () => 'was null')).toEqual(Err('was null'));
    });
    test('returns Err for undefined', () => {
      expect(fromNullable(undefined, () => 'was undef')).toEqual(Err('was undef'));
    });
  });

  describe('mapError', () => {
    test('passes through Ok unchanged', () => {
      expect(mapError(ok, (e) => `wrapped: ${e}`)).toEqual(Ok(42));
    });
    test('transforms Err', () => {
      expect(mapError(err, (e) => `wrapped: ${e}`)).toEqual(Err('wrapped: fail'));
    });
  });

  describe('collect', () => {
    test('collects all Ok values', () => {
      expect(collect([Ok(1), Ok(2), Ok(3)])).toEqual(Ok([1, 2, 3]));
    });
    test('returns first Err', () => {
      expect(collect([Ok(1), Err('bad'), Ok(3)])).toEqual(Err('bad'));
    });
    test('returns Ok([]) for empty array', () => {
      expect(collect([])).toEqual(Ok([]));
    });
  });

  describe('fromPredicate', () => {
    test('returns Ok when predicate passes', () => {
      expect(
        fromPredicate(
          10,
          (n) => n > 5,
          () => 'too small'
        )
      ).toEqual(Ok(10));
    });
    test('returns Err when predicate fails', () => {
      expect(
        fromPredicate(
          3,
          (n) => n > 5,
          (n) => `${n} is too small`
        )
      ).toEqual(Err('3 is too small'));
    });
  });
});
