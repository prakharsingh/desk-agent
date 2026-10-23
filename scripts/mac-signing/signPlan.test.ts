import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM without types
import { orderForSigning, IDENTIFIER_OVERRIDES, REQUIRED_SIGNED_PATHS, EXPECTED_CERT_SHA1, expectedCertSha1 } from './signPlan.mjs';

export const fixture = [
  { rel: 'Contents/MacOS/desk-agent-display-helper', kind: 'macho' as const },
  { rel: 'Contents/Frameworks/Electron Framework.framework', kind: 'bundle' as const },
  { rel: 'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib', kind: 'macho' as const },
  { rel: 'Contents/Frameworks/Desk Agent Helper.app', kind: 'bundle' as const },
  { rel: 'Contents/Frameworks/Desk Agent Helper.app/Contents/MacOS/Desk Agent Helper', kind: 'macho' as const },
];

describe('orderForSigning', () => {
  it('signs nested code before the bundle that contains it', () => {
    expect(orderForSigning(fixture)).toEqual([
      'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib',
      'Contents/Frameworks/Desk Agent Helper.app/Contents/MacOS/Desk Agent Helper',
      'Contents/Frameworks/Desk Agent Helper.app',
      'Contents/Frameworks/Electron Framework.framework',
      'Contents/MacOS/desk-agent-display-helper',
    ]);
  });

  it('never includes the app root', () => {
    expect(orderForSigning([{ rel: '', kind: 'bundle' }])).toEqual([]);
  });
});

describe('signing constants', () => {
  it('overrides the display-helper and adb identifiers', () => {
    expect(IDENTIFIER_OVERRIDES['Contents/MacOS/desk-agent-display-helper']).toBe('com.deskagent.mac.display-helper');
    expect(IDENTIFIER_OVERRIDES['Contents/MacOS/adb']).toBe('com.deskagent.mac.adb');
  });

  it('requires the app, helper apps and the display helper (not yet adb)', () => {
    expect(REQUIRED_SIGNED_PATHS).toEqual([
      { rel: '', identifier: 'com.deskagent.mac' },
      { rel: 'Contents/Frameworks/*.app' },
      { rel: 'Contents/MacOS/desk-agent-display-helper', identifier: 'com.deskagent.mac.display-helper' },
    ]);
  });
});

describe('expectedCertSha1', () => {
  it('defaults to the committed fingerprint', () => {
    expect(EXPECTED_CERT_SHA1).toBe('B8B3F4B81BF50F599521EC37EB83ABBB76E86EB2');
    expect(expectedCertSha1({})).toBe(EXPECTED_CERT_SHA1);
    expect(expectedCertSha1({ DESK_AGENT_MAC_SIGN_EXPECTED_SHA1: '  ' })).toBe(EXPECTED_CERT_SHA1);
  });

  it('honours the rotation override, upper-cased', () => {
    expect(expectedCertSha1({ DESK_AGENT_MAC_SIGN_EXPECTED_SHA1: 'ab'.repeat(20) })).toBe('AB'.repeat(20));
  });

  it('rejects a malformed override', () => {
    expect(() => expectedCertSha1({ DESK_AGENT_MAC_SIGN_EXPECTED_SHA1: 'nothex' })).toThrow(/40-hex/);
  });
});
