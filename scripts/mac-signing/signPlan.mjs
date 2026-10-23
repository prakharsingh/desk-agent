// Pure helpers for the macOS signing plan: what to sign, in which order, and
// which code objects must carry which identifier afterwards.

/**
 * SHA-1 of the committed Desk Agent signing certificate (public, not a secret).
 * Every release must be signed by exactly this identity, otherwise the
 * designated requirement changes and users' privacy grants go stale.
 * Rotation: see packaging/MAC_SIGNING.md.
 */
export const EXPECTED_CERT_SHA1 = 'B8B3F4B81BF50F599521EC37EB83ABBB76E86EB2';

/**
 * The SHA-1 the release must be signed with: the committed constant, unless
 * DESK_AGENT_MAC_SIGN_EXPECTED_SHA1 overrides it (deliberate rotation).
 * Returned upper-case; throws on a malformed override.
 */
export function expectedCertSha1(env = process.env) {
  const override = String(env.DESK_AGENT_MAC_SIGN_EXPECTED_SHA1 ?? '').trim();
  const value = override || EXPECTED_CERT_SHA1;
  if (!/^[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`DESK_AGENT_MAC_SIGN_EXPECTED_SHA1 is not a 40-hex-digit SHA-1: "${value}"`);
  }
  return value.toUpperCase();
}

/** Identifier overrides for standalone Mach-O binaries (default: codesign's own). */
export const IDENTIFIER_OVERRIDES = {
  'Contents/MacOS/desk-agent-display-helper': 'com.deskagent.mac.display-helper',
  'Contents/MacOS/adb': 'com.deskagent.mac.adb',
};

/**
 * Paths assert-signed.mjs verifies. `rel` is relative to the .app; a glob is
 * allowed only as the final segment. adb is not bundled yet, so it is absent.
 */
export const REQUIRED_SIGNED_PATHS = [
  { rel: '', identifier: 'com.deskagent.mac' },
  { rel: 'Contents/Frameworks/*.app' },
  { rel: 'Contents/MacOS/desk-agent-display-helper', identifier: 'com.deskagent.mac.display-helper' },
];

const depth = (rel) => rel.split('/').filter(Boolean).length;

/**
 * Inside-out signing order: deepest path first, so every bundle comes after
 * everything beneath it. Ties break by path for determinism. The app root is
 * never included (signed last by signApp).
 */
export function orderForSigning(entries) {
  return entries
    .map((e) => e.rel.replace(/\/+$/, ''))
    .filter((rel) => rel !== '')
    .sort((a, b) => depth(b) - depth(a) || (a < b ? -1 : a > b ? 1 : 0));
}
