import { camelCase } from 'change-case';

const PARENTHESES_PATTERN = /\s*\([^)]*\)\s*/g;
const INVALID_CHARS_PATTERN = /[^A-Za-z0-9_'-]/g;
const LEADING_TRAILING_UNDERSCORES_PATTERN = /^_+|_+$/g;
const MULTIPLE_UNDERSCORES_PATTERN = /_+/g;
const VALID_IDENTIFIER_START_PATTERN = /^[A-Za-z_]/;
const LEADING_UNDERSCORE_PREFIX = '_';
const WORD_PATTERN = /[0-9]+[a-z]+|[A-Z]+(?=[A-Z][a-z]|[0-9]|$)|[A-Z]?[a-z]+|[0-9]+/g;

function sanitizeIdentifierInput(name: string): {
  sanitized: string;
  originalStartsWithUnderscore: boolean;
  originalEndsWithUnderscore: boolean;
} {
  return {
    originalStartsWithUnderscore: name.startsWith('_'),
    originalEndsWithUnderscore: name.endsWith('_'),
    sanitized: name
      .replace(PARENTHESES_PATTERN, '')
      .replace(INVALID_CHARS_PATTERN, '_')
      .replace(LEADING_TRAILING_UNDERSCORES_PATTERN, '')
      .replace(MULTIPLE_UNDERSCORES_PATTERN, '_'),
  };
}

function finalizeIdentifier(
  sanitized: string,
  originalStartsWithUnderscore: boolean,
  originalEndsWithUnderscore: boolean,
  needsPrefix: boolean
): string {
  if (
    originalStartsWithUnderscore &&
    !originalEndsWithUnderscore &&
    sanitized &&
    VALID_IDENTIFIER_START_PATTERN.test(sanitized)
  )
    return '_' + sanitized;
  if (needsPrefix || sanitized.length === 0 || !VALID_IDENTIFIER_START_PATTERN.test(sanitized))
    sanitized = LEADING_UNDERSCORE_PREFIX + sanitized;

  return sanitized;
}

/**
 * Legacy public Nix identifier normalization.
 *
 * Kept for compatibility migration generation because older nixcord releases
 * intentionally preserved acronym-heavy upstream names.
 */
export function toLegacyNixIdentifier(name: string): string {
  const {
    originalStartsWithUnderscore,
    originalEndsWithUnderscore,
    sanitized: initialSanitized,
  } = sanitizeIdentifierInput(name);
  let sanitized = initialSanitized;

  const needsPrefix = sanitized.length === 0 || !VALID_IDENTIFIER_START_PATTERN.test(sanitized);

  const hasAcronym = /[A-Z]{2}/.test(sanitized);

  const needsCamelCase = sanitized.includes('_') || sanitized.includes(' ');
  if (!hasAcronym || needsCamelCase) {
    try {
      sanitized = camelCase(sanitized);
    } catch {}
  }

  return finalizeIdentifier(
    sanitized,
    originalStartsWithUnderscore,
    originalEndsWithUnderscore,
    needsPrefix
  );
}

function capitalize(word: string): string {
  return word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1);
}

function normalizePluralAcronyms(segment: string): string {
  return segment.replace(/([A-Z]{2,})s(?=$|[A-Z])/g, '$1S');
}

/**
 * Sanitize and convert a name to a valid public Nix identifier.
 * Uses acronym-aware word splitting so upstream names like ClearURLs become
 * clearUrls instead of the change-case output clearUrLs.
 */
export function toNixIdentifier(name: string): string {
  const {
    originalStartsWithUnderscore,
    originalEndsWithUnderscore,
    sanitized: initialSanitized,
  } = sanitizeIdentifierInput(name);
  const needsPrefix =
    initialSanitized.length === 0 || !VALID_IDENTIFIER_START_PATTERN.test(initialSanitized);

  const words = initialSanitized
    .split(/[_\s'-]+/)
    .flatMap((segment) => normalizePluralAcronyms(segment).match(WORD_PATTERN) ?? [])
    .map((word) => word.toLowerCase());

  const sanitized =
    words.length === 0
      ? initialSanitized
      : words.map((word, index) => (index === 0 ? word : capitalize(word))).join('');

  return finalizeIdentifier(
    sanitized,
    originalStartsWithUnderscore,
    originalEndsWithUnderscore,
    needsPrefix
  );
}
