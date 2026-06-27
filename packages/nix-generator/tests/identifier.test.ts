import { describe, expect, test } from 'vitest';
import { toLegacyNixIdentifier, toNixIdentifier } from '../src/identifier.js';

describe('toNixIdentifier()', () => {
  test.each([
    ['ClearURLs', 'clearUrls'],
    ['CopyUserURLs', 'copyUserUrls'],
    ['PinDMs', 'pinDms'],
    ['BlurNSFW', 'blurNsfw'],
    ['PronounDB', 'pronounDb'],
    ['AutoDNDWhilePlaying', 'autoDndWhilePlaying'],
    ['RecentDMSwitcher', 'recentDmSwitcher'],
    ['MutualGroupDMs', 'mutualGroupDms'],
    ['OnePingPerDM', 'onePingPerDm'],
    ['XSOverlay', 'xsOverlay'],
    ['BadgeAPI', 'badgeApi'],
    ['LastFMRichPresence', 'lastFmRichPresence'],
  ])('normalizes acronym-heavy plugin names: %s -> %s', (input, expected) => {
    expect(toNixIdentifier(input)).toBe(expected);
  });

  test.each([
    ['WebRichPresence (arRPC)', 'webRichPresence'],
    ['Test Plugin!', 'testPlugin'],
    ['test-plugin', 'testPlugin'],
    ["test'plugin", 'testPlugin'],
    ['Translate+', 'translatePlus'],
    ['24h Time', '_24hTime'],
    ['_leading', '_leading'],
  ])('preserves existing identifier edge cases: %s -> %s', (input, expected) => {
    expect(toNixIdentifier(input)).toBe(expected);
  });
});

describe('toLegacyNixIdentifier()', () => {
  test.each([
    ['ClearURLs', 'ClearURLs'],
    ['PinDMs', 'PinDMs'],
    ['BlurNSFW', 'BlurNSFW'],
    ['MessageLogger', 'messageLogger'],
  ])('preserves legacy output: %s -> %s', (input, expected) => {
    expect(toLegacyNixIdentifier(input)).toBe(expected);
  });
});
