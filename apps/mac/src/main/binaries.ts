import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { BinaryStatus } from '../shared/types.js';

// A GUI-launched app (Finder double-click, LaunchServices) gets a minimal
// PATH -- typically /usr/bin:/bin:/usr/sbin:/sbin -- missing both Homebrew
// (nowplaying-cli) and the Android SDK (adb), even though both work fine
// from a dev terminal where a shell profile has already extended PATH. This
// is the exact "silently breaks on first real launch" gap the Phase 0
// reality-check flagged. These are the well-known install locations for
// each; augmentedPath() below is what actually fixes it (see coreSupervisor
// wiring), findBinary/checkBinaries only answer "is it there" for the
// Overview pane's status display.
export const DEFAULT_CANDIDATE_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  path.join(os.homedir(), 'Library/Android/sdk/platform-tools'),
];

export function findBinary(name: string, candidateDirs: string[] = DEFAULT_CANDIDATE_DIRS): string | null {
  for (const dir of candidateDirs) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function isExecutableFile(file: string): boolean {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface ResolvedAdb {
  path: string;
  source: 'user' | 'bundled';
}

// The one adb every Desk Agent component uses (core via DESK_AGENT_ADB, the
// dock-watch LaunchAgent via its baked script). The user's own adb wins so we
// never run a second adb server of a different version against their phone;
// the bundled copy is only the fallback.
export function resolveAdb(opts: { candidateDirs?: string[]; pathEnv?: string; bundledPath: string | null }): ResolvedAdb | null {
  const dirs = [...(opts.candidateDirs ?? DEFAULT_CANDIDATE_DIRS), ...(opts.pathEnv ?? process.env.PATH ?? '').split(':').filter(Boolean)];
  for (const dir of dirs) {
    const candidate = path.join(dir, 'adb');
    if (isExecutableFile(candidate)) return { path: candidate, source: 'user' };
  }
  if (opts.bundledPath && isExecutableFile(opts.bundledPath)) return { path: opts.bundledPath, source: 'bundled' };
  return null;
}

export function checkBinaries(
  candidateDirs: string[] = DEFAULT_CANDIDATE_DIRS,
  adb: ResolvedAdb | null = resolveAdb({ candidateDirs, bundledPath: null }),
): BinaryStatus {
  return {
    adb: adb !== null,
    adbPath: adb?.path ?? null,
    adbSource: adb?.source ?? null,
    nowplayingCli: findBinary('nowplaying-cli', candidateDirs) !== null,
  };
}

// Prepends every candidate dir that exists on disk (regardless of whether
// it holds a specific known binary -- harmless to include a dir with
// neither adb nor nowplaying-cli) to the given PATH, so the core's existing
// execFile('adb', ...) / execFile('nowplaying-cli', ...) calls (unmodified)
// find them via normal PATH resolution, exactly as they already do when run
// from a terminal. This is the general fix -- augmenting PATH once, here --
// rather than threading a path override through every individual exec call
// site in packages/core.
export function augmentedPath(currentPath: string, candidateDirs: string[] = DEFAULT_CANDIDATE_DIRS): string {
  const existing = currentPath.split(':').filter(Boolean);
  const toPrepend = candidateDirs.filter((dir) => fs.existsSync(dir) && !existing.includes(dir));
  return [...toPrepend, ...existing].join(':');
}
