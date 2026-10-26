import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM without types
import { checkRequirement } from './requirement.mjs';

describe('checkRequirement', () => {
  it('passes a self-signed requirement with the expected identifier', () => {
    const err = 'Executable=/x\ndesignated => identifier "com.deskagent.mac" and certificate root = H"0a1b"\n';
    expect(checkRequirement(err, { identifier: 'com.deskagent.mac' })).toEqual({ ok: true, problems: [] });
  });

  it('passes an untrusted self-signed requirement anchored on the leaf certificate hash', () => {
    // What codesign actually emits for the untrusted self-signed cert (Task 0.3 Step 3).
    const err = 'designated => identifier "com.deskagent.mac" and certificate leaf = H"b8b3f4b8"\n';
    expect(checkRequirement(err, { identifier: 'com.deskagent.mac' })).toEqual({ ok: true, problems: [] });
  });

  it('rejects a requirement with no certificate hash anchor', () => {
    const r = checkRequirement('designated => identifier "com.deskagent.mac"', {});
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/anchor/);
  });

  it('rejects an ad-hoc cdhash requirement', () => {
    const r = checkRequirement('designated => cdhash H"abcd"\n', {});
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/cdhash/);
  });

  it('rejects a wrong identifier', () => {
    const r = checkRequirement('designated => identifier "Electron" and certificate root = H"0a1b"', {
      identifier: 'com.deskagent.mac',
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/com\.deskagent\.mac/);
  });

  it('does not let the app identifier match a longer identifier it prefixes', () => {
    const r = checkRequirement(
      'designated => identifier "com.deskagent.mac.display-helper" and certificate root = H"0a1b"',
      { identifier: 'com.deskagent.mac' },
    );
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/com\.deskagent\.mac"/);
  });

  describe('certHash pin', () => {
    const hash = 'b8b3f4b81bf50f599521ec37eb83abbb76e86eb2';
    const line = (h: string, kind = 'leaf') => `designated => identifier "com.deskagent.mac" and certificate ${kind} = H"${h}"\n`;

    it('accepts a matching hash', () => {
      expect(checkRequirement(line(hash), { certHash: hash })).toEqual({ ok: true, problems: [] });
      expect(checkRequirement(line(hash, 'root'), { certHash: hash }).ok).toBe(true);
    });

    it('rejects a different certificate hash', () => {
      const r = checkRequirement(line('0000f4b81bf50f599521ec37eb83abbb76e80000'), { certHash: hash });
      expect(r.ok).toBe(false);
      expect(r.problems.join(' ')).toMatch(/pinned to certificate 0000f4b8.*expected b8b3f4b8/);
    });

    it('compares case-insensitively', () => {
      expect(checkRequirement(line(hash), { certHash: hash.toUpperCase() }).ok).toBe(true);
      expect(checkRequirement(line(hash.toUpperCase()), { certHash: hash }).ok).toBe(true);
    });

    it('does not pin when certHash is omitted', () => {
      expect(checkRequirement(line('ab'), {}).ok).toBe(true);
    });
  });

  it('fails when there is no designated line', () => {
    expect(checkRequirement('', {}).ok).toBe(false);
  });
});
