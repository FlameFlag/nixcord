import { camelCase } from 'change-case';
import { isEmpty } from 'remeda';
import { match, P } from 'ts-pattern';

const INTERPOLATION_START_SEQUENCE_LENGTH = 2;
const ESCAPED_BACKSLASH = '\\\\';
const ESCAPED_INTERPOLATION = '\\${';
const ESCAPED_QUOTE = '\\"';

const BACKSLASH_CHAR = '\\';
const DOLLAR_CHAR = '$';
const OPEN_BRACE_CHAR = '{';
const DOUBLE_QUOTE_CHAR = '"';

export function escapeNixDoubleQuotedString(str: string): string {
  let result = '';
  let i = 0;

  while (i < str.length) {
    const char = str[i];
    const next = i + 1 < str.length ? str[i + 1] : null;

    const [escaped, increment] = match([char, next] as const)
      .with([BACKSLASH_CHAR, P._], () => [ESCAPED_BACKSLASH, 1] as const)
      .with([DOLLAR_CHAR, OPEN_BRACE_CHAR], () => [ESCAPED_INTERPOLATION, INTERPOLATION_START_SEQUENCE_LENGTH] as const)
      .with([DOUBLE_QUOTE_CHAR, P._], () => [ESCAPED_QUOTE, 1] as const)
      .otherwise(() => [char, 1] as const);

    result += escaped;
    i += increment;
  }

  return result;
}

const NIX_MULTILINE_START = "''";
const ESCAPED_DOUBLE_QUOTE = "'''";
const DOLLAR_PREFIX = "''$";
const ESCAPED_NEWLINE = "''\\\n";
const SINGLE_QUOTE_CHAR = "'";
const SPACE_CHAR = ' ';

const DOUBLE_QUOTE_PATTERN = /''/g;
const DOLLAR_PATTERN = /\$/g;
const ESCAPED_NEWLINE_PATTERN = /\\\n/g;
const SINGLE_QUOTE_AT_END_PATTERN = /\s'$/;

export function escapeNixString(str: string): string {
  let escaped = str
    .replace(DOUBLE_QUOTE_PATTERN, ESCAPED_DOUBLE_QUOTE)
    .replace(DOLLAR_PATTERN, DOLLAR_PREFIX)
    .replace(ESCAPED_NEWLINE_PATTERN, ESCAPED_NEWLINE);

  if (escaped.endsWith(SINGLE_QUOTE_CHAR) && !escaped.endsWith(NIX_MULTILINE_START) && !escaped.match(SINGLE_QUOTE_AT_END_PATTERN)) {
    escaped += SPACE_CHAR;
  }
  return escaped;
}

export const toCamelCase = (str: string): string => isEmpty(str) ? str : camelCase(str);

const PARENTHESES_PATTERN = /\s*\([^)]*\)\s*/g;
const INVALID_CHARS_PATTERN = /[^A-Za-z0-9_'-]/g;
const LEADING_TRAILING_UNDERSCORES_PATTERN = /^_+|_+$/g;
const MULTIPLE_UNDERSCORES_PATTERN = /_+/g;
const VALID_IDENTIFIER_START_PATTERN = /^[A-Za-z_]/;
const LEADING_UNDERSCORE_PREFIX = '_';

export function sanitizeNixIdentifier(str: string): string {
  const sanitized = toCamelCase(
    str
      .replace(PARENTHESES_PATTERN, '')
      .replace(INVALID_CHARS_PATTERN, '_')
      .replace(LEADING_TRAILING_UNDERSCORES_PATTERN, '')
      .replace(MULTIPLE_UNDERSCORES_PATTERN, '_')
  );

  return isEmpty(sanitized) || !VALID_IDENTIFIER_START_PATTERN.test(sanitized)
    ? LEADING_UNDERSCORE_PREFIX + sanitized
    : sanitized;
}
