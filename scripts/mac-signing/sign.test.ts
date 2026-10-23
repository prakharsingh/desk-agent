import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM without types
import { defaultListEntries, resolveIdentity, signApp } from './sign.mjs';

const entries = [
  { rel: 'Contents/MacOS/desk-agent-display-helper', kind: 'macho' as const },
  { rel: 'Contents/Frameworks/Electron Framework.framework', kind: 'bundle' as const },
  { rel: 'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib', kind: 'macho' as const },
  { rel: 'Contents/Frameworks/Desk Agent Helper.app', kind: 'bundle' as const },
  { rel: 'Contents/Frameworks/Desk Agent Helper.app/Contents/MacOS/Desk Agent Helper', kind: 'macho' as const },
];

function harness(env: NodeJS.ProcessEnv) {
  const calls: string[][] = [];
  const run = () =>
    signApp('/out/Desk Agent.app', {
      env,
      exec: async (cmd: string, args: string[]) => {
        calls.push([cmd, ...args]);
      },
      listEntries: async () => entries,
    });
  return { calls, run };
}

describe('signApp', () => {
  it('falls back to ad-hoc when no identity is configured', async () => {
    const { calls, run } = harness({});
    const res = await run();
    expect(res.mode).toBe('adhoc');
    expect(calls.length).toBe(entries.length + 1);
    for (const c of calls) {
      expect(c[0]).toBe('codesign');
      expect(c.slice(c.indexOf('--sign'), c.indexOf('--sign') + 2)).toEqual(['--sign', '-']);
    }
  });

  it('uses the identity, keychain and the display-helper identifier override', async () => {
    const { calls, run } = harness({
      DESK_AGENT_MAC_SIGN_IDENTITY: 'ABC123',
      DESK_AGENT_MAC_SIGN_KEYCHAIN: 'build.keychain',
    });
    const res = await run();
    expect(res.mode).toBe('self-signed');
    const helper = calls.find((c) => c.at(-1)!.endsWith('desk-agent-display-helper'))!;
    expect(helper.join(' ')).toContain(
      '--sign ABC123 --keychain build.keychain --identifier com.deskagent.mac.display-helper',
    );
  });

  it('signs the app bundle last with identifier com.deskagent.mac', async () => {
    const { calls, run } = harness({});
    await run();
    const last = calls.at(-1)!;
    expect(last.at(-1)).toBe('/out/Desk Agent.app');
    expect(last.join(' ')).toContain('--identifier com.deskagent.mac ');
    expect(last.join(' ')).not.toMatch(/runtime/);
  });

  it('forces re-signing and never enables the hardened runtime on any call', async () => {
    const { calls, run } = harness({});
    await run();
    for (const c of calls) {
      expect(c).toContain('--force');
      expect(c.join(' ')).not.toMatch(/runtime/);
    }
  });

  it('propagates a codesign failure instead of swallowing it', async () => {
    await expect(
      signApp('/out/Desk Agent.app', {
        env: {},
        exec: async () => {
          throw new Error('codesign failed: boom');
        },
        listEntries: async () => entries,
      }),
    ).rejects.toThrow(/boom/);
  });

  it('refuses to fall back to ad-hoc on the release path', async () => {
    const { run } = harness({ DESK_AGENT_REQUIRE_SIGNED: '1' });
    await expect(run()).rejects.toThrow(/DESK_AGENT_REQUIRE_SIGNED/);
  });
});

describe('resolveIdentity', () => {
  it('returns ad-hoc by default', () => {
    expect(resolveIdentity({})).toEqual({ identity: '-', mode: 'adhoc' });
  });
});

describe('resolveIdentity edge cases', () => {
  it.each(['', '   ', '-', ' - '])('treats %j as not configured (ad-hoc)', (id) => {
    expect(resolveIdentity({ DESK_AGENT_MAC_SIGN_IDENTITY: id })).toEqual({ identity: '-', mode: 'adhoc' });
  });

  it.each(['', '   ', '-'])('throws under REQUIRE_SIGNED when the identity is %j', (id) => {
    expect(() => resolveIdentity({ DESK_AGENT_REQUIRE_SIGNED: '1', DESK_AGENT_MAC_SIGN_IDENTITY: id })).toThrow(
      /REQUIRE_SIGNED/,
    );
  });
});

describe('defaultListEntries', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mac-signing-fixture-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'Fixture.app');
  const put = (rel: string, bytes: Buffer | string) => {
    const full = path.join(app, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, bytes);
  };
  const magic = (hex: string) => Buffer.from(hex + '00000000', 'hex');

  put('Contents/MacOS/thin', magic('cffaedfe'));
  put('Contents/MacOS/fat', magic('cafebabe'));
  put('Contents/MacOS/fat64', magic('cafebabf'));
  put('Contents/MacOS/notes.txt', 'plain text, not code');
  put('Contents/MacOS/tiny', Buffer.from('cf', 'hex'));
  put('Contents/Frameworks/Foo.framework/Versions/A/Foo', magic('cffaedfe'));
  put('Contents/Frameworks/Foo.framework/Versions/A/Resources/Info.plist', '<plist/>');
  symlinkSync('A', path.join(app, 'Contents/Frameworks/Foo.framework/Versions/Current'));
  symlinkSync('Versions/Current/Foo', path.join(app, 'Contents/Frameworks/Foo.framework/Foo'));
  put('Contents/Frameworks/Bar Helper.app/Contents/MacOS/Bar Helper', magic('feedfacf'));
  symlinkSync('thin', path.join(app, 'Contents/MacOS/thin-link'));
  put('Outside/outside', magic('cffaedfe'));

  it('lists Mach-O files (thin, fat, fat64) and .app/.framework bundles, skipping everything else', async () => {
    const got = (await defaultListEntries(app)) as { rel: string; kind: string }[];
    const sorted = got.map((e) => `${e.kind}:${e.rel}`).sort();
    expect(sorted).toEqual(
      [
        'macho:Contents/MacOS/thin',
        'macho:Contents/MacOS/fat',
        'macho:Contents/MacOS/fat64',
        'bundle:Contents/Frameworks/Foo.framework',
        'macho:Contents/Frameworks/Foo.framework/Versions/A/Foo',
        'bundle:Contents/Frameworks/Bar Helper.app',
        'macho:Contents/Frameworks/Bar Helper.app/Contents/MacOS/Bar Helper',
      ].sort(),
    );
  });

  it('does not follow symlinks (Versions/Current, top-level framework links, file links)', async () => {
    const rels = ((await defaultListEntries(app)) as { rel: string }[]).map((e) => e.rel);
    expect(rels.some((r) => r.includes('Versions/Current'))).toBe(false);
    expect(rels).not.toContain('Contents/Frameworks/Foo.framework/Foo');
    expect(rels).not.toContain('Contents/MacOS/thin-link');
  });

  it('never lists the app root or anything outside Contents/', async () => {
    const rels = ((await defaultListEntries(app)) as { rel: string }[]).map((e) => e.rel);
    expect(rels).not.toContain('');
    expect(rels.every((r) => r.startsWith('Contents/'))).toBe(true);
  });
});
