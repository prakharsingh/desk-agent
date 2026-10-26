import { execFileSync, spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import type { DisplayReason } from '@desk-agent/protocol';
import { encodeHelperCommand, parseHelperEventLine, type HelperEvent, type HelperStartCommand } from './displayHelperProtocol.js';

/** Contract E: HELPER_STOP_TERM_MS / HELPER_STOP_KILL_MS. */
const STOP_TERM_MS = 2000;
const STOP_KILL_MS = 4000;
const HELPER_BASENAME = 'desk-agent-display-helper';

/** The slice of ChildProcess the host uses, so tests can fake it. */
export interface HelperChildLike {
  pid?: number;
  stdin: { write(chunk: string): unknown; end(): unknown; on(event: 'error', cb: (err: Error) => void): unknown };
  stdout: { on(event: 'data', cb: (chunk: Buffer | string) => void): unknown; setEncoding?(enc: BufferEncoding): unknown } | null;
  stderr: { on(event: 'data', cb: (chunk: Buffer | string) => void): unknown } | null;
  on(event: 'exit', cb: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  /** Node's 'spawn': the process really started (never emitted after a spawn error such as ENOENT). */
  on(event: 'spawn', cb: () => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface DisplayHelperHostOptions {
  helperPath: string;
  pidfilePath: string;
  onEvent: (e: HelperEvent) => void;
  onExit: (info: { reason: DisplayReason; code: number | null; signal: NodeJS.Signals | null; error?: string }) => void;
  onStderr?: (text: string) => void;
  /** The helper process actually spawned (Node 'spawn' event). Not called when spawning fails. */
  onSpawn?: () => void;
  spawn?: (cmd: string, args: string[]) => HelperChildLike;
  processName?: (pid: number) => string | null;
  killPid?: (pid: number, sig: NodeJS.Signals) => void;
}

// The real child reports 'exit' possibly before its stdout is drained, which would lose a trailing `ended`
// line and misreport a clean end as a crash. 'close' fires after the stdio streams end, so the host's
// 'exit' hook is wired to it.
const defaultSpawn = (cmd: string, args: string[]): HelperChildLike => {
  const cp = nodeSpawn(cmd, args, { stdio: 'pipe' });
  return {
    get pid() { return cp.pid; },
    stdin: cp.stdin,
    stdout: cp.stdout,
    stderr: cp.stderr,
    on(event: string, cb: (...a: never[]) => void) {
      cp.on(event === 'exit' ? 'close' : event, cb as never);
      return this;
    },
    kill: (sig) => cp.kill(sig),
  } as HelperChildLike;
};

const defaultProcessName = (pid: number): string | null => {
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8', timeout: 2000 }).trim();
    return out || null;
  } catch {
    return null;
  }
};

const defaultKillPid = (pid: number, sig: NodeJS.Signals): void => {
  try {
    process.kill(pid, sig);
  } catch {
    // already gone
  }
};

/**
 * Owns the one display-helper process (Electron main is its sole owner). One process per session; a crashed
 * helper is never restarted here. The session token travels on stdin only, never argv.
 */
export class DisplayHelperHost {
  private child: HelperChildLike | null = null;
  private stopping = false;
  private endedReason: DisplayReason | null = null;
  private spawnError: string | undefined;
  private lineBuf = '';
  private termTimer: NodeJS.Timeout | null = null;
  private killTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: DisplayHelperHostOptions) {}

  isRunning(): boolean {
    return this.child !== null;
  }

  /** Kills a helper left over from a previous (crashed) app run. Only a process whose name ends with the helper binary name is touched; the pidfile is always removed. */
  killStale(): void {
    if (this.child) return;
    const processName = this.opts.processName ?? defaultProcessName;
    const killPid = this.opts.killPid ?? defaultKillPid;
    let pid = NaN;
    try {
      pid = parseInt(fs.readFileSync(this.opts.pidfilePath, 'utf8').trim(), 10);
    } catch {
      // no pidfile
    }
    this.removePidfile();
    if (!Number.isInteger(pid) || pid <= 1) return;
    const isHelper = () => processName(pid)?.endsWith(HELPER_BASENAME) === true;
    if (!isHelper()) return;
    killPid(pid, 'SIGTERM');
    const t = setTimeout(() => {
      if (isHelper()) killPid(pid, 'SIGKILL');
    }, STOP_TERM_MS);
    t.unref?.();
  }

  start(cmd: HelperStartCommand): void {
    if (this.child) throw new Error('display helper already running');
    const child = (this.opts.spawn ?? defaultSpawn)(this.opts.helperPath, ['serve']);
    this.child = child;
    this.stopping = false;
    this.endedReason = null;
    this.spawnError = undefined;
    this.lineBuf = '';

    if (child.pid !== undefined) {
      try {
        fs.writeFileSync(this.opts.pidfilePath, `${child.pid}\n`);
      } catch {
        // best effort: a missing pidfile only weakens stale-process cleanup
      }
    }

    child.stdout?.setEncoding?.('utf8');
    child.stdout?.on('data', (chunk) => this.onStdout(chunk.toString()));
    child.stderr?.on('data', (chunk) => this.opts.onStderr?.(chunk.toString()));
    child.stdin.on('error', () => {
      // EPIPE when the helper already exited; the 'exit' handler reports it
    });

    let finished = false;
    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (finished) return;
      finished = true;
      this.flushLine();
      this.clearTimers();
      if (this.child === child) this.child = null;
      this.removePidfile();
      this.opts.onExit({
        reason: this.endedReason ?? 'helper-crashed', code, signal,
        ...(this.spawnError !== undefined ? { error: this.spawnError } : {}),
      });
    };
    child.on('exit', finish);
    child.on('spawn', () => {
      if (finished) return;
      try {
        this.opts.onSpawn?.();
      } catch (err) {
        this.opts.onStderr?.(`display helper onSpawn threw: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    });
    child.on('error', (err: Error) => {
      // Only a failure to spawn is terminal (ENOENT/EACCES on a mis-packaged path). Any later error (e.g. a
      // failed kill()) leaves a possibly-live process, so keep owning it until 'exit'.
      if (child.pid === undefined) {
        this.spawnError = err.message;
        finish(null, null);
      } else {
        this.opts.onStderr?.(`display helper child error: ${err.message}\n`);
      }
    });

    try {
      child.stdin.write(encodeHelperCommand(cmd));
    } catch {
      // surfaces through exit
    }
  }

  stop(): void {
    const child = this.child;
    if (!child || this.stopping) return;
    this.stopping = true;
    try {
      child.stdin.write(encodeHelperCommand({ cmd: 'stop' }));
      child.stdin.end();
    } catch {
      // stdin already closed; escalation below still applies
    }
    this.termTimer = setTimeout(() => {
      if (this.child === child) child.kill('SIGTERM');
    }, STOP_TERM_MS);
    this.killTimer = setTimeout(() => {
      if (this.child === child) child.kill('SIGKILL');
    }, STOP_KILL_MS);
  }

  private onStdout(text: string): void {
    this.lineBuf += text;
    let nl: number;
    while ((nl = this.lineBuf.indexOf('\n')) >= 0) {
      const line = this.lineBuf.slice(0, nl);
      this.lineBuf = this.lineBuf.slice(nl + 1);
      this.handleLine(line);
    }
  }

  private flushLine(): void {
    const rest = this.lineBuf;
    this.lineBuf = '';
    if (rest.trim()) this.handleLine(rest);
  }

  private handleLine(line: string): void {
    const evt = parseHelperEventLine(line.trim());
    if (!evt) return;
    if (evt.evt === 'ended') this.endedReason = evt.reason;
    try {
      this.opts.onEvent(evt);
    } catch (err) {
      this.opts.onStderr?.(`display helper onEvent threw: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  private clearTimers(): void {
    if (this.termTimer) clearTimeout(this.termTimer);
    if (this.killTimer) clearTimeout(this.killTimer);
    this.termTimer = this.killTimer = null;
  }

  private removePidfile(): void {
    try {
      fs.rmSync(this.opts.pidfilePath, { force: true });
    } catch {
      // ignore
    }
  }
}
