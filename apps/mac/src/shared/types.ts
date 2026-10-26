// Types shared across the main/preload/renderer process boundary. Pure
// type declarations only -- no runtime code, no Node built-ins -- so any
// process can import from here (as `import type`) without risking a
// bundler pulling Node-only code into the sandboxed renderer, the way
// importing types straight from a main-process module like binaries.ts
// would if that module ever gained a non-type-only export.
import type { ToApp } from '@desk-agent/core';
import type { Config } from '@desk-agent/config-schema';

export interface BinaryStatus {
  adb: boolean;
  /** The single adb every component uses (see resolveAdb), or null. */
  adbPath: string | null;
  adbSource: 'user' | 'bundled' | null;
  nowplayingCli: boolean;
}

// What the main process pushes on 'status:message': the core's ToApp messages
// forwarded verbatim, plus 'snapshotCleared' when the core leaves 'running'
// (see main/snapshotCache.ts) so the renderer drops its now-stale snapshot,
// plus 'configChanged' when main persisted a config change the renderer did
// not originate (a phone-side Monitor wake toggle -- see main/wakeSync.ts).
export type StatusMessage = ToApp | { kind: 'snapshotCleared' } | { kind: 'configChanged'; config: Config };
