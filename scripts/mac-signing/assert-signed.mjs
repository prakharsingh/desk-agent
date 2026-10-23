#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRequirement } from './requirement.mjs';
import { REQUIRED_SIGNED_PATHS, expectedCertSha1 } from './signPlan.mjs';

export function designatedRequirement(target) {
  return new Promise((resolve) => {
    execFile('codesign', ['-d', '-r-', target], (err, stdout, stderr) => {
      resolve({ err, output: `${stdout}\n${stderr}` });
    });
  });
}

/** Expand a trailing-segment glob like `Contents/Frameworks/*.app` into relative paths. */
function expand(appPath, rel) {
  if (!rel.includes('*')) return [rel];
  const dir = path.posix.dirname(rel);
  const pattern = new RegExp(`^${path.posix.basename(rel).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  const abs = path.join(appPath, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((n) => pattern.test(n))
    .map((n) => path.posix.join(dir, n));
}

export async function assertSigned(
  appPath,
  { requirementOf = designatedRequirement, certHash = expectedCertSha1() } = {},
) {
  const failures = [];
  for (const { rel, identifier } of REQUIRED_SIGNED_PATHS) {
    const targets = expand(appPath, rel);
    if (targets.length === 0) failures.push(`${rel}: no match found`);
    for (const t of targets) {
      const abs = path.join(appPath, t);
      if (!existsSync(abs)) {
        failures.push(`${t || '.'}: missing`);
        continue;
      }
      const { err, output } = await requirementOf(abs);
      if (err) {
        failures.push(`${t || '.'}: codesign failed: ${output.trim()}`);
        continue;
      }
      const { ok, problems } = checkRequirement(output, { identifier, certHash });
      if (!ok) for (const p of problems) failures.push(`${t || '.'}: ${p}`);
    }
  }
  return failures;
}

/** True when this file is the process entry point, even when invoked through a symlinked path. */
function isMain() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const appPath = process.argv[2];
  if (!appPath) {
    console.error('usage: assert-signed.mjs "<path to Desk Agent.app>"');
    process.exit(2);
  }
  const failures = await assertSigned(appPath);
  for (const f of failures) console.error(`FAIL ${f}`);
  if (failures.length) process.exit(1);
  console.log('all required paths carry a stable designated requirement');
}
