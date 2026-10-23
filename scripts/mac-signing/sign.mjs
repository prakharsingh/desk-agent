import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { IDENTIFIER_OVERRIDES, orderForSigning } from './signPlan.mjs';

const execFileP = promisify(execFile);

export const APP_IDENTIFIER = 'com.deskagent.mac';

/** Default exec: run a command, reject with stderr on failure. */
export async function defaultExec(cmd, args) {
  try {
    await execFileP(cmd, args, { maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${err.stderr || err.message}`);
  }
}

export function resolveIdentity(env) {
  // Blank or '-' means "not configured": '-' is codesign's ad-hoc identity and must never count as self-signed.
  const identity = (env.DESK_AGENT_MAC_SIGN_IDENTITY ?? '').trim();
  if (identity && identity !== '-') {
    const keychain = env.DESK_AGENT_MAC_SIGN_KEYCHAIN;
    return keychain ? { identity, keychain, mode: 'self-signed' } : { identity, mode: 'self-signed' };
  }
  if (env.DESK_AGENT_REQUIRE_SIGNED === '1') {
    throw new Error('DESK_AGENT_REQUIRE_SIGNED=1 but DESK_AGENT_MAC_SIGN_IDENTITY is not set');
  }
  return { identity: '-', mode: 'adhoc' };
}

const MACHO_MAGICS = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'cafebabf']);

async function isMachO(file) {
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const buf = Buffer.alloc(4);
    const { bytesRead } = await handle.read(buf, 0, 4, 0);
    return bytesRead === 4 && MACHO_MAGICS.has(buf.toString('hex'));
  } finally {
    await handle?.close();
  }
}

/** Walk Contents/ (symlinks skipped) collecting Mach-O files and .app/.framework bundles. */
export async function defaultListEntries(appPath) {
  const entries = [];
  async function walk(dir) {
    for (const d of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, d.name);
      if (d.isSymbolicLink()) continue;
      const rel = path.relative(appPath, full);
      if (d.isDirectory()) {
        if (/\.(app|framework)$/.test(d.name)) entries.push({ rel, kind: 'bundle' });
        await walk(full);
      } else if (d.isFile() && (await isMachO(full))) {
        entries.push({ rel, kind: 'macho' });
      }
    }
  }
  await walk(path.join(appPath, 'Contents'));
  return entries;
}

export async function signApp(appPath, opts) {
  const { env, exec, listEntries = defaultListEntries } = opts;
  const { identity, keychain, mode } = resolveIdentity(env);
  const codesign = (target, identifier) => {
    const args = ['--force', '--timestamp=none', '--sign', identity];
    if (keychain) args.push('--keychain', keychain);
    if (identifier) args.push('--identifier', identifier);
    args.push(target);
    return exec('codesign', args);
  };

  const signed = [];
  for (const rel of orderForSigning(await listEntries(appPath))) {
    await codesign(path.join(appPath, rel), IDENTIFIER_OVERRIDES[rel]);
    signed.push(rel);
  }
  await codesign(appPath, APP_IDENTIFIER);
  signed.push('');
  return { mode, signed };
}
