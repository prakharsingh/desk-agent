import type { DisplayOrientation, DisplayReason } from '@desk-agent/protocol';

// Contract C: Electron main <-> Swift helper (`desk-agent-display-helper serve`).
// Key names mirror Sources/DisplayHelperCore/HelperIO.swift (StartCommand, HelperEvent, EndReason).

export interface HelperStartCommand {
  cmd: 'start';
  sessionId: string;
  token: string;
  port: number;
  surfaceW: number;
  surfaceH: number;
  orientation: DisplayOrientation;
  serialNum: number;
  vendorId: number;
  productId: number;
  dpi?: number;
}

export type HelperEvent =
  | { evt: 'ready'; displayId: number; port: number }
  | { evt: 'connected' }
  | { evt: 'paused' }
  | { evt: 'resumed' }
  | { evt: 'stats'; fps: number; kbps: number; unacked: number; ackP50Ms: number; ackP95Ms: number; phoneRendered: number; phoneDropped: number }
  | { evt: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { evt: 'ended'; reason: DisplayReason };

/** The `ended.reason` values the helper may emit (Contract C / Swift `EndReason`). */
const HELPER_END_REASONS: ReadonlySet<string> = new Set([
  'stop-requested', 'phone-bye', 'watchdog', 'connect-timeout', 'parent-exit', 'unsupported', 'capture-unavailable',
  'permission-screen-recording', 'capture-failed', 'port-in-use', 'signal', 'protocol-error', 'version-mismatch',
  'display-offline', 'mac-asleep',
]);

const STATS_KEYS = ['fps', 'kbps', 'unacked', 'ackP50Ms', 'ackP95Ms', 'phoneRendered', 'phoneDropped'] as const;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Parses one stdout line. Returns null for anything that is not a well-formed Contract C event. An `ended` with an unknown reason maps to `helper-crashed`. */
export function parseHelperEventLine(line: string): HelperEvent | null {
  let o: unknown;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  switch (r.evt) {
    case 'ready':
      return isNum(r.displayId) && isNum(r.port) ? { evt: 'ready', displayId: r.displayId, port: r.port } : null;
    case 'connected':
    case 'paused':
    case 'resumed':
      return { evt: r.evt };
    case 'stats': {
      if (!STATS_KEYS.every((k) => isNum(r[k]))) return null;
      return {
        evt: 'stats', fps: r.fps as number, kbps: r.kbps as number, unacked: r.unacked as number,
        ackP50Ms: r.ackP50Ms as number, ackP95Ms: r.ackP95Ms as number,
        phoneRendered: r.phoneRendered as number, phoneDropped: r.phoneDropped as number,
      };
    }
    case 'log':
      if (typeof r.message !== 'string') return null;
      return { evt: 'log', level: r.level === 'warn' || r.level === 'error' ? r.level : 'info', message: r.message };
    case 'ended': {
      const reason = typeof r.reason === 'string' && HELPER_END_REASONS.has(r.reason) ? (r.reason as DisplayReason) : 'helper-crashed';
      return { evt: 'ended', reason };
    }
    default:
      return null;
  }
}

export function encodeHelperCommand(cmd: HelperStartCommand | { cmd: 'stop' }): string {
  return JSON.stringify(cmd) + '\n';
}

/** FNV-1a 32-bit over the UTF-8 bytes, unsigned. Never 0: macOS treats a display serial of 0 as "none". */
export function stableDisplaySerial(deviceSerial: string): number {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(deviceSerial, 'utf8')) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  h >>>= 0;
  return h === 0 ? 1 : h;
}
