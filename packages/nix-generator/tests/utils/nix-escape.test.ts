import { describe, test, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  escapeNixDoubleQuotedString,
  escapeNixString,
  sanitizeNixIdentifier,
  toCamelCase,
} from '../../src/utils/nix-escape.js';

const nixEvalEnv = prepareNixEvalEnv();

function prepareNixEvalEnv(): NodeJS.ProcessEnv {
  try {
    const baseDir = mkdtempSync(join(tmpdir(), 'nix-eval-state-'));
    const user = process.env.USER ?? 'nix-test';
    const dirs = [
      baseDir,
      join(baseDir, 'profiles'),
      join(baseDir, 'profiles', 'per-user'),
      join(baseDir, 'profiles', 'per-user', user),
      join(baseDir, 'gcroots'),
      join(baseDir, 'gcroots', 'per-user'),
      join(baseDir, 'gcroots', 'per-user', user),
      join(baseDir, 'temproots'),
      join(baseDir, 'logs'),
    ];

    for (const dir of dirs) {
      mkdirSync(dir, { recursive: true });
    }

    return {
      ...process.env,
      USER: user,
      HOME: process.env.HOME ?? baseDir,
      NIX_REMOTE: process.env.NIX_REMOTE ?? 'local',
      NIX_STATE_DIR: baseDir,
      NIX_LOG_DIR: join(baseDir, 'logs'),
    };
  } catch {
    return process.env;
  }
}

function testNixExpression(expr: string): string {
  const tmpFile = join(
    tmpdir(),
    `nix-test-${Date.now()}-${Math.random().toString(36).slice(2)}.nix`
  );
  try {
    writeFileSync(tmpFile, expr, 'utf-8');
    const result = execSync(`nix-instantiate --eval "${tmpFile}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: nixEvalEnv,
    }).trim();
    return result;
  } catch (error: unknown) {
    const err = error as { stderr?: { toString(): string }; message?: string };
    const stderr = err.stderr?.toString() ?? err.message ?? String(error);
    throw new Error(`Nix expression failed: ${expr}\nError: ${stderr}`);
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }
}

// Test data for escapeNixDoubleQuotedString
const doubleQuotedCases = [
  // Basic cases
  {
    description: 'empty string',
    input: '',
    expected: '""',
  },
  {
    description: 'simple text',
    input: 'simple text',
    expected: '"simple text"',
  },

  // Template variables (found in generated files)
  {
    description: 'single template variable {name}',
    input: '{name}',
    expected: '"{name}"',
  },
  {
    description: 'double curly braces {{NAME}}',
    input: '{{NAME}}',
    expected: '"{{NAME}}"',
  },
  {
    description: 'complex template {artist} · {album}',
    input: '{artist} · {album}',
    expected: '"{artist} · {album}"',
  },
  {
    description: 'template variable {album}',
    input: '{album}',
    expected: '"{album}"',
  },
  {
    description: 'template variable {artist}',
    input: '{artist}',
    expected: '"{artist}"',
  },

  // Special characters and separators (from generated files)
  {
    description: 'comma-separated passwords',
    input: 'password, Password',
    expected: '"password, Password"',
  },
  {
    description: 'comma-separated user IDs',
    input: '1234567890123445,1234567890123445',
    expected: '"1234567890123445,1234567890123445"',
  },
  {
    description: 'semicolon-separated logger names',
    input: 'GatewaySocket; Routing/Utils',
    expected: '"GatewaySocket; Routing/Utils"',
  },
  {
    description: 'keyboard shortcut with plus',
    input: 'ctrl+enter',
    expected: '"ctrl+enter"',
  },
  {
    description: 'pipe separator',
    input: '|',
    expected: '"|"',
  },

  // Quotes and interpolation
  {
    description: 'string with double quotes inside',
    input: 'Say "hello" to the world',
    expected: '"Say \\"hello\\" to the world"',
  },
  {
    description: 'complex string with quotes and dollar',
    input: 'User said "It costs $50" yesterday',
    expected: '"User said \\"It costs $50\\" yesterday"',
  },
  {
    description: 'string with dollar sign',
    input: 'Price is $10.99',
    expected: '"Price is $10.99"',
  },
  {
    description: 'string with interpolation sequence ${variable}',
    input: 'Value is ${variable} here',
    expected: '"Value is \\${variable} here"',
  },
  {
    description: 'string with escaped interpolation \\${HOME}',
    input: 'Path is \\${HOME}/config',
    expected: '"Path is \\\\\\${HOME}/config"',
  },

  // Backslashes
  {
    description: 'string with backslashes',
    input: 'Path: C:\\Users\\Name',
    expected: '"Path: C:\\\\Users\\\\Name"',
  },
  {
    description: 'string with all special chars',
    input: 'Test "quotes" $dollar ${interp} \\backslash',
    expected: '"Test \\"quotes\\" $dollar \\${interp} \\\\backslash"',
  },

  // Other special characters
  {
    description: 'hex color code',
    input: '#8a2be2',
    expected: '"#8a2be2"',
  },
  {
    description: 'Apple Music default value',
    input: 'Apple Music',
    expected: '"Apple Music"',
  },
];

// Test data for escapeNixString
const multilineStringCases = [
  // Basic cases
  {
    description: 'empty string',
    input: '',
    expected: '""',
  },
  {
    description: 'simple description',
    input: 'Simple description',
    expected: '"Simple description"',
  },

  // Ampersands (found in generated files)
  {
    description: 'ampersand in description',
    input: 'Adds the ability to copy & open Sticker links',
    expected: '"Adds the ability to copy & open Sticker links"',
  },
  {
    description: 'ampersand and parentheses',
    input: 'Allows you to clone Emotes & Stickers to your own server (right click them)',
    expected: '"Allows you to clone Emotes & Stickers to your own server (right click them)"',
  },
  {
    description: 'ampersand in middle',
    input: 'Display the file name of images & GIFs as a tooltip when hovering over them',
    expected: '"Display the file name of images & GIFs as a tooltip when hovering over them"',
  },

  // Single quotes (EXTREME edge cases from generated files)
  {
    description: "single quote at end - 'likely spammers'",
    input: "Do not hide messages from 'likely spammers'",
    expected: '"Do not hide messages from \'likely spammers\' "',
  },
  {
    description: "single quote in middle - 'Potentially Dangerous Download'",
    input:
      "Remove the 'Potentially Dangerous Download' popup when opening links (restart required)",
    expected:
      '"Remove the \'Potentially Dangerous Download\' popup when opening links (restart required)"',
  },
  {
    description: 'single quote in middle (real)',
    input: 'cat follow mouse (real)',
    expected: '"cat follow mouse (real)"',
  },
  {
    description: "contraction it's",
    input:
      "Keep showing guild icons in the primary guild bar folder when it's open in the BetterFolders sidebar (restart required)",
    expected:
      '"Keep showing guild icons in the primary guild bar folder when it\'s open in the BetterFolders sidebar (restart required)"',
  },
  {
    description: "contraction don't",
    input: "Apply colors only to users who don't have a predefined color",
    expected: '"Apply colors only to users who don\'t have a predefined color"',
  },
  {
    description: "contraction you'll",
    input:
      "If unread messages are sent by a user in DMs multiple times, you'll only receive one audio ping. Read the messages to reset the limit",
    expected:
      '"If unread messages are sent by a user in DMs multiple times, you\'ll only receive one audio ping. Read the messages to reset the limit"',
  },

  // @mentions (from generated files)
  {
    description: '@everyone and @here in group DMs',
    input: 'Receive audio pings for @everyone and @here in group DMs',
    expected: '"Receive audio pings for @everyone and @here in group DMs"',
  },
  {
    description: '@mentions alone',
    input: 'Receive audio pings for @mentions',
    expected: '"Receive audio pings for @mentions"',
  },
  {
    description: 'suppress @everyone and @here',
    input: 'Suppress @everyone and @here',
    expected: '"Suppress @everyone and @here"',
  },
  {
    description: 'suppress all role @mentions',
    input: 'Suppress All Role @mentions',
    expected: '"Suppress All Role @mentions"',
  },

  // Template variables in multiline strings (from generated files)
  {
    description: 'template variable {{NAME}} with explanation',
    input:
      'What text the hyperlink should use. {{NAME}} will be replaced with the emoji/sticker name.',
    expected:
      '"What text the hyperlink should use. {{NAME}} will be replaced with the emoji/sticker name."',
  },
  {
    description: 'activity details format string',
    input: 'Activity details format string',
    expected: '"Activity details format string"',
  },

  // Parentheses and restart required (common pattern in generated files)
  {
    description: 'restart required pattern',
    input: 'Hide Arrow (restart required)',
    expected: '"Hide Arrow (restart required)"',
  },
  {
    description: 'parentheses with status values',
    input: 'Automatically updates your online status (online, idle, dnd) when launching games',
    expected: '"Automatically updates your online status (online, idle, dnd) when launching games"',
  },
  {
    description: 'nested parentheses',
    input: 'Remove the untrusted domain popup when opening links (restart required)',
    expected: '"Remove the untrusted domain popup when opening links (restart required)"',
  },

  // EXTREME: Complex nested quotes (most extreme cases from generated files)
  {
    description: "EXTREME: nested double quotes with don't",
    input:
      'Bypass the permission lockout prevention ("Pretty sure you don\'t want to do this") (restart required)',
    expected:
      '"Bypass the permission lockout prevention (\\"Pretty sure you don\'t want to do this\\") (restart required)"',
  },
  {
    description: 'EXTREME: nested double quotes with complex text',
    input:
      'Bypass the onboarding requirements ("Making this change will make your server incompatible [...]") (restart required)',
    expected:
      '"Bypass the onboarding requirements (\\"Making this change will make your server incompatible [...]\\") (restart required)"',
  },

  // Long descriptions (from generated files)
  {
    description: 'long description with multiple sentences',
    input:
      'Show the full URL of the image instead of just the file name. Always enabled for GIFs because they usually have no meaningful file name',
    expected:
      '"Show the full URL of the image instead of just the file name. Always enabled for GIFs because they usually have no meaningful file name"',
  },
  {
    description: 'very long description with multiple clauses',
    input:
      'Enhances the sessions (devices) menu. Allows you to view exact timestamps, give each session a custom name, and receive notifications about new sessions.',
    expected:
      '"Enhances the sessions (devices) menu. Allows you to view exact timestamps, give each session a custom name, and receive notifications about new sessions."',
  },
  {
    description: 'long description with large guilds warning',
    input:
      "Track users in large guilds. This may cause lag if you're in a lot of large guilds with active voice users. Tested with up to 2000 active voice users with no issues. (restart required)",
    expected:
      '"Track users in large guilds. This may cause lag if you\'re in a lot of large guilds with active voice users. Tested with up to 2000 active voice users with no issues. (restart required)"',
  },

  // Unicode and emoji (from generated files)
  {
    description: 'unicode emoji 👽',
    input: 'Copy the raw unicode character instead of :name: for default emojis (👽)',
    expected: '"Copy the raw unicode character instead of :name: for default emojis (👽)"',
  },

  // Backticks (from generated files)
  {
    description: 'backticks in description',
    input: 'Run `shortcutList` for a list.',
    expected: '"Run `shortcutList` for a list."',
  },
  {
    description: 'backticks with longer text',
    input: 'Adds shorter Aliases for many things on the window. Run `shortcutList` for a list.',
    expected:
      '"Adds shorter Aliases for many things on the window. Run `shortcutList` for a list."',
  },

  // Punctuation combinations (from generated files)
  {
    description: 'question mark in parentheses',
    input:
      "Change the Help (?) toolbar button (top right in chat) to Discord's developer menu (restart required)",
    expected:
      '"Change the Help (?) toolbar button (top right in chat) to Discord\'s developer menu (restart required)"',
  },
  {
    description: 'exclamation mark',
    input: 'Encrypt your Messages in a non-suspicious way!',
    expected: '"Encrypt your Messages in a non-suspicious way!"',
  },
  {
    description: 'period and single quote',
    input: 'Shows your implicit relationships in the Friends tab.',
    expected: '"Shows your implicit relationships in the Friends tab."',
  },
  {
    description: 'colon and semicolon',
    input: 'Saved Passwords (Seperated with a , )',
    expected: '"Saved Passwords (Seperated with a , )"',
  },
  {
    description: 'multiple punctuation',
    input: 'Brings back the option to pause invites indefinitely that stupit Discord removed.',
    expected: '"Brings back the option to pause invites indefinitely that stupit Discord removed."',
  },
  {
    description: 'comma-separated list mention',
    input: 'List of users to allow or exempt pings for (separated by commas or spaces)',
    expected: '"List of users to allow or exempt pings for (separated by commas or spaces)"',
  },
  {
    description: 'semicolons in description',
    input: 'Semi colon separated list of loggers to allow even if others are hidden',
    expected: '"Semi colon separated list of loggers to allow even if others are hidden"',
  },

  // Complex cases with multiple special characters
  {
    description: 'description with multiple special chars',
    input:
      "Keep showing guild icons in the primary guild bar folder when it's open in the BetterFolders sidebar (restart required)",
    expected:
      '"Keep showing guild icons in the primary guild bar folder when it\'s open in the BetterFolders sidebar (restart required)"',
  },
  {
    description: 'description with apostrophe in word',
    input: 'Enhances your settings-menu-opening experience',
    expected: '"Enhances your settings-menu-opening experience"',
  },
  {
    description: 'description with slash and parentheses',
    input: 'Adds shorter Aliases for many things on the window. Run `shortcutList` for a list.',
    expected:
      '"Adds shorter Aliases for many things on the window. Run `shortcutList` for a list."',
  },
];

describe('escapeNixDoubleQuotedString', () => {
  for (const testCase of doubleQuotedCases) {
    test(testCase.description, () => {
      const escaped = escapeNixDoubleQuotedString(testCase.input);
      const result = testNixExpression(`"${escaped}"`);
      expect(result).toBe(testCase.expected);
    });
  }
});

describe('escapeNixString', () => {
  for (const testCase of multilineStringCases) {
    test(testCase.description, () => {
      const escaped = escapeNixString(testCase.input);
      const result = testNixExpression(`''${escaped}''`);
      expect(result).toBe(testCase.expected);
    });
  }
});

describe('identifier helpers', () => {
  test('toCamelCase preserves empty inputs and camel-cases phrases', () => {
    expect(toCamelCase('')).toBe('');
    expect(toCamelCase('guild icon colors')).toBe('guildIconColors');
  });

  test('sanitizeNixIdentifier normalises symbols found in plugin names', () => {
    expect(sanitizeNixIdentifier("BetterFolders (Don't Break)")).toBe('betterFolders');
    expect(sanitizeNixIdentifier('1234 custom-title')).toBe('_1234CustomTitle');
    expect(sanitizeNixIdentifier('Spaces / odd__chars!!')).toBe('spacesOddChars');
  });
});
