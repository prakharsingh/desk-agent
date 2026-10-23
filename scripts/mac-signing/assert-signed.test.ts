import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM without types
import { assertSigned } from './assert-signed.mjs';
// @ts-expect-error plain ESM without types
import { EXPECTED_CERT_SHA1 } from './signPlan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(path.join(tmpdir(), 'assert-signed-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const good = (id: string) => ({ err: null, output: `designated => identifier "${id}" and certificate leaf = H"${EXPECTED_CERT_SHA1.toLowerCase()}"\n` });
const adhoc = { err: null, output: 'designated => cdhash H"abcd"\n' };

function makeApp(name: string, helpers: string[]) {
  const app = path.join(root, name);
  mkdirSync(path.join(app, 'Contents/Frameworks'), { recursive: true });
  mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
  for (const h of helpers) mkdirSync(path.join(app, 'Contents/Frameworks', h), { recursive: true });
  execFileSync('touch', [path.join(app, 'Contents/MacOS/desk-agent-display-helper')]);
  return app;
}

describe('assertSigned', () => {
  it('passes when every required path (root, glob matches, helper) has a stable requirement', async () => {
    const app = makeApp('ok.app', ['A Helper.app', 'B Helper.app']);
    const seen: string[] = [];
    const failures = await assertSigned(app, {
      requirementOf: async (abs: string) => {
        seen.push(path.relative(app, abs));
        return good(abs === app ? 'com.deskagent.mac' : abs.endsWith('display-helper') ? 'com.deskagent.mac.display-helper' : 'x');
      },
    });
    expect(failures).toEqual([]);
    expect(seen.sort()).toEqual(
      ['', 'Contents/Frameworks/A Helper.app', 'Contents/Frameworks/B Helper.app', 'Contents/MacOS/desk-agent-display-helper'].sort(),
    );
  });

  it('expands the *.app glob to only .app entries and fails each ad-hoc match', async () => {
    const app = makeApp('glob.app', ['A Helper.app', 'Other.framework']);
    const failures: string[] = await assertSigned(app, {
      requirementOf: async (abs: string) =>
        /A Helper\.app|Other\.framework/.test(abs) ? adhoc : good(abs === app ? 'com.deskagent.mac' : 'com.deskagent.mac.display-helper'),
    });
    expect(failures.some((f) => f.startsWith('Contents/Frameworks/A Helper.app:') && /cdhash/.test(f))).toBe(true);
    expect(failures.some((f) => f.includes('Other.framework'))).toBe(false);
    expect(failures.filter((f) => /cdhash/.test(f))).toHaveLength(1);
  });

  it('reports "no match found" when the glob matches nothing', async () => {
    const app = makeApp('nomatch.app', []);
    const failures: string[] = await assertSigned(app, { requirementOf: async () => good('com.deskagent.mac') });
    expect(failures).toContain('Contents/Frameworks/*.app: no match found');
  });

  it('reports a missing literal path (including the root)', async () => {
    const failures: string[] = await assertSigned(path.join(root, 'absent.app'), {
      requirementOf: async () => good('com.deskagent.mac'),
    });
    expect(failures).toContain('.: missing');
    expect(failures).toContain('Contents/MacOS/desk-agent-display-helper: missing');
  });

  it('fails when the requirement is pinned to a different certificate', async () => {
    const app = makeApp('wrongcert.app', ['A.app']);
    const failures: string[] = await assertSigned(app, {
      requirementOf: async (abs: string) => ({
        err: null,
        output: `designated => identifier "${abs === app ? 'com.deskagent.mac' : abs.endsWith('display-helper') ? 'com.deskagent.mac.display-helper' : 'x'}" and certificate leaf = H"${'ab'.repeat(20)}"\n`,
      }),
    });
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every((f) => /expected b8b3f4b8/.test(f))).toBe(true);
  });

  it('accepts a different certificate when the expected hash is overridden', async () => {
    const app = makeApp('rotated.app', ['A.app']);
    const failures: string[] = await assertSigned(app, {
      certHash: 'AB'.repeat(20),
      requirementOf: async (abs: string) => ({
        err: null,
        output: `designated => identifier "${abs === app ? 'com.deskagent.mac' : abs.endsWith('display-helper') ? 'com.deskagent.mac.display-helper' : 'x'}" and certificate leaf = H"${'ab'.repeat(20)}"\n`,
      }),
    });
    expect(failures).toEqual([]);
  });

  it('reports a codesign error as a failure', async () => {
    const app = makeApp('err.app', ['A.app']);
    const failures: string[] = await assertSigned(app, {
      requirementOf: async () => ({ err: new Error('x'), output: 'not signed' }),
    });
    expect(failures.some((f) => /codesign failed/.test(f))).toBe(true);
  });
});

describe('assert-signed CLI', () => {
  const script = path.join(here, 'assert-signed.mjs');
  const linkDir = path.join(root, 'linked');
  symlinkSync(here, linkDir);

  it('exits 1 on a missing app when run directly', () => {
    const r = spawnSync('node', [script, path.join(root, 'nope.app')], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/missing/);
  });

  it('exits 1 on a missing app when run through a symlinked path (no fail-open)', () => {
    const r = spawnSync('node', [path.join(linkDir, 'assert-signed.mjs'), path.join(root, 'nope.app')], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/missing/);
  });

  it('exits 1 on an app with no signature when run through a symlinked path', () => {
    const app = makeApp('unsigned.app', ['A.app']);
    const r = spawnSync('node', [path.join(linkDir, 'assert-signed.mjs'), app], { encoding: 'utf8' });
    expect(r.status).toBe(1);
  });

  it('exits 2 with usage when no path is given', () => {
    const r = spawnSync('node', [path.join(linkDir, 'assert-signed.mjs')], { encoding: 'utf8' });
    expect(r.status).toBe(2);
  });
});
