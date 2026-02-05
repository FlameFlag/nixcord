import { camelCase } from 'change-case';
import { pipe, isEmpty, keys, omitBy, sortBy } from 'remeda';
import { match, P } from 'ts-pattern';
import type { ReadonlyDeep } from 'type-fest';
import { isArray, isNonNullObject } from '../shared/type-guards.js';
import { escapeNixDoubleQuotedString, escapeNixString } from './utils/nix-escape.js';

const visitedObjects = new WeakSet<object>();

export type NixValue = string | number | boolean | null | NixValue[] | NixAttrSet | NixRaw;

export interface NixAttrSet {
  [key: string]: NixValue | undefined;
}

export type ReadonlyNixAttrSet = ReadonlyDeep<Record<string, NixValue | undefined>>;

export interface NixRaw {
  type: 'raw';
  value: string;
}

export interface NixGeneratorOptions {
  indent: string;
}

const DEFAULT_INDENT = '  ';
const NIX_NULL = 'null';
const NIX_RAW_TYPE = 'raw';
const NIX_LIST_OPEN = '[';
const NIX_LIST_CLOSE = ']';
const NIX_EMPTY_LIST = '[ ]';
const NIX_ATTR_SET_OPEN = '{';
const NIX_ATTR_SET_CLOSE = '}';
const NIX_EMPTY_ATTR_SET = '{ }';
const NIX_ASSIGNMENT = ' = ';
const NIX_LIST_SEPARATOR = '\n';
const NIX_STATEMENT_TERMINATOR = ';';
const NIX_MULTILINE_STRING_START = "''";
const NIX_MULTILINE_STRING_END = "''";
const NIX_DOUBLE_QUOTED_STRING_START = '"';
const NIX_DOUBLE_QUOTED_STRING_END = '"';
const NEWLINE_CHAR = '\n';

export class NixGenerator {
  private readonly options: Readonly<NixGeneratorOptions>;

  constructor(options?: Partial<NixGeneratorOptions>) {
    this.options = { indent: options?.indent ?? DEFAULT_INDENT };
  }

  private indent(level: number = 1): string {
    return this.options.indent.repeat(level);
  }

  string(str: string, multiline: boolean = false): string {
    return match(str.includes(NEWLINE_CHAR) || multiline)
      .with(
        true,
        () => `${NIX_MULTILINE_STRING_START}${escapeNixString(str)}${NIX_MULTILINE_STRING_END}`
      )
      .otherwise(
        () =>
          `${NIX_DOUBLE_QUOTED_STRING_START}${escapeNixDoubleQuotedString(str)}${NIX_DOUBLE_QUOTED_STRING_END}`
      );
  }

  number(n: number): string {
    return n.toString();
  }

  boolean(b: boolean): string {
    return b.toString();
  }

  nullValue(): string {
    return NIX_NULL;
  }

  raw(value: string): NixRaw {
    return { type: NIX_RAW_TYPE, value };
  }

  list(items: readonly NixValue[], level: number = 0): string {
    if (isEmpty(items)) return NIX_EMPTY_LIST;
    const indent = this.indent(level);
    const itemIndent = this.indent(level + 1);
    const result: string[] = [NIX_LIST_OPEN];
    for (const item of items) result.push(`${itemIndent}${this.value(item, level + 1)}`);
    result.push(`${indent}${NIX_LIST_CLOSE}`);
    return result.join(NIX_LIST_SEPARATOR);
  }

  attrSet(attrs: ReadonlyNixAttrSet | NixAttrSet, level: number = 0): string {
    const filteredAttrs = omitBy(attrs, (value) => value === undefined);
    let sortedKeys = pipe(
      filteredAttrs,
      keys(),
      sortBy((x) => x)
    );
    const enableIdx = sortedKeys.indexOf('enable');
    if (enableIdx !== -1) {
      sortedKeys = [...sortedKeys];
      sortedKeys.splice(enableIdx, 1);
      sortedKeys.unshift('enable');
    }

    if (isEmpty(sortedKeys)) return NIX_EMPTY_ATTR_SET;

    const indent = this.indent(level);
    const propIndent = this.indent(level + 1);
    const result: string[] = [NIX_ATTR_SET_OPEN];
    for (const key of sortedKeys) {
      const attrValue = filteredAttrs[key];
      if (attrValue === undefined) continue;
      result.push(
        `${propIndent}${this.identifier(key)}${NIX_ASSIGNMENT}${this.value(attrValue as NixValue, level + 1)}${NIX_STATEMENT_TERMINATOR}`
      );
    }
    result.push(`${indent}${NIX_ATTR_SET_CLOSE}`);
    return result.join(NIX_LIST_SEPARATOR);
  }

  value(val: NixValue, level: number = 0): string {
    const isRaw =
      isNonNullObject(val) &&
      !isArray(val) &&
      'type' in val &&
      (val as unknown as NixRaw).type === NIX_RAW_TYPE;
    if (isRaw) return (val as unknown as NixRaw).value;

    const isPlainObject = isNonNullObject(val) && !isArray(val);
    if (isPlainObject) {
      if (visitedObjects.has(val)) return 'null';
      visitedObjects.add(val);
    }

    try {
      if (isArray(val)) return this.list(val as readonly NixValue[], level);
      if (typeof val === 'string') return this.string(val);
      if (typeof val === 'number') return this.number(val);
      if (typeof val === 'boolean') return this.boolean(val);
      if (val === null) return this.nullValue();
      if (isPlainObject) return this.attrSet(val as unknown as NixAttrSet, level);
      return NIX_NULL;
    } finally {
      if (isPlainObject && !isRaw) visitedObjects.delete(val);
    }
  }

  private static readonly PARENTHESES_PATTERN = /\s*\([^)]*\)\s*/g;
  private static readonly INVALID_CHARS_PATTERN = /[^A-Za-z0-9_'-]/g;
  private static readonly LEADING_TRAILING_UNDERSCORES_PATTERN = /^_+|_+$/g;
  private static readonly MULTIPLE_UNDERSCORES_PATTERN = /_+/g;
  private static readonly VALID_IDENTIFIER_START_PATTERN = /^[A-Za-z_]/;
  private static readonly LEADING_UNDERSCORE_PREFIX = '_';

  identifier(name: string): string {
    const originalStartsWithUnderscore = name.startsWith('_');
    const originalEndsWithUnderscore = name.endsWith('_');
    let sanitized = name
      .replace(NixGenerator.PARENTHESES_PATTERN, '')
      .replace(NixGenerator.INVALID_CHARS_PATTERN, '_')
      .replace(NixGenerator.LEADING_TRAILING_UNDERSCORES_PATTERN, '')
      .replace(NixGenerator.MULTIPLE_UNDERSCORES_PATTERN, '_');

    const needsPrefix =
      isEmpty(sanitized) || !NixGenerator.VALID_IDENTIFIER_START_PATTERN.test(sanitized);

    const hasAcronym = (() => {
      for (let i = 0; i < sanitized.length - 1; i++) {
        const char = sanitized.charAt(i);
        const nextChar = sanitized.charAt(i + 1);
        if (char >= 'A' && char <= 'Z' && nextChar >= 'A' && nextChar <= 'Z') return true;
      }
      return false;
    })();

    const needsCamelCase = sanitized.includes('_') || sanitized.includes(' ');
    sanitized =
      hasAcronym && !needsCamelCase
        ? sanitized
        : (() => {
            try {
              return camelCase(sanitized);
            } catch {
              return sanitized;
            }
          })();

    if (
      originalStartsWithUnderscore &&
      !originalEndsWithUnderscore &&
      sanitized &&
      NixGenerator.VALID_IDENTIFIER_START_PATTERN.test(sanitized)
    )
      return '_' + sanitized;
    if (
      needsPrefix ||
      isEmpty(sanitized) ||
      !NixGenerator.VALID_IDENTIFIER_START_PATTERN.test(sanitized)
    )
      sanitized = NixGenerator.LEADING_UNDERSCORE_PREFIX + sanitized;

    return sanitized;
  }
}
