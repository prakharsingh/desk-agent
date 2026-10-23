import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM without types
import { checkRequirement } from './requirement.mjs';

describe('checkRequirement', () => {
  it('passes a self-signed requirement with the expected identifier', () => {
    const err = 'Executable=/x\ndesignated => identifier "com.deskagent.mac" and certificate root = H"0a1b"\n';
    expect(checkRequirement(err, { identifier: 'com.deskagent.mac' })).toEqual({ ok: true, problems: [] });
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

  it('fails when there is no designated line', () => {
    expect(checkRequirement('', {}).ok).toBe(false);
  });
});
