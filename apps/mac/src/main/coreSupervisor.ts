import { createRequire } from 'node:module';
import type { UtilityProcess } from 'electron';

// A lazy require (instead of a static `import { utilityProcess } from
// 'electron'`) so this module loads cleanly under Vitest: the 'electron'
// package resolves to a plain string path outside a real Electron runtime,
// which breaks Vite's static import resolution. Tests always inject a fake
// `fork`, so this is only ever actually invoked inside the real app.
const require = createRequire(import.meta.url);

export type CoreHealth = 'starting' | 'running' | 'crashed' | 'stopped';

type ForkFn = (
  modulePath: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; stdio: 'pipe' },
) => UtilityProcess;

export interface CoreSupervisorOptions {
  coreHostPath: string;
  configPath: string;
  /** Defaults to 5, matching WorkerHost's plugin-crash backoff policy. */
  maxRestarts?: number;
  onHealthChange?: (health: CoreHealth) => void;
  /** The core's ControlChannel messages (ToApp), forwarded verbatim -- see coreHost.ts's transport adapter. */
  onMessage?: (msg: unknown) => void;
  /** Raw stderr text from the forked child, line-buffered by Electron's pipe (not necessarily one call per line). Surfaces a boot-time crash (e.g. a missing module inside the packaged asar) that happens before the core can construct its ControlChannel and emit a structured log -- the caller decides where this becomes user-visible (e.g. the Logs pane), this class only reports it. */
  onStderr?: (text: string) => void;
  /** Called fresh on every spawn (not just once) to merge over process.env for the forked child -- e.g. index.ts passes an augmented PATH (see binaries.ts) so the core's adb/nowplaying-cli execFile calls find them under a GUI-launched app's minimal PATH. A function, not a static object, so a restart picks up binaries installed after the app launched. Deliberately generic: this class has no Desk-Agent-specific binary knowledge. */
  extraEnv?: () => Record<string, string>;
  /** Injectable for testing without a real Electron runtime. */
  fork?: ForkFn;
}

const defaultFork: ForkFn = (modulePath, args, opts) => {
  const { utilityProcess } = require('electron');
  return utilityProcess.fork(modulePath, args, opts);
};

// Mirrors packages/core/src/workerHost.ts's crash-backoff curve (same
// exponential formula, same 30s cap). The reset semantics differ
// deliberately, not accidentally: WorkerHost's restart counter never resets
// (a plugin worker has no manual-restart concept, so its crash budget is
// cumulative for the process's lifetime), whereas here `restarts` resets to
// 0 only on an explicit start()/restart() call -- a crash-free spawn does
// NOT reset it, so crashes remain cumulative since the last start()/
// restart() (not just "consecutive") until maxRestarts is exhausted and
// health becomes 'crashed'. This lets a user-initiated "restart core" action
// re-arm the budget explicitly, rather than the process silently regaining
// restart budget just by staying up for a while.
export class CoreSupervisor {
  private child: UtilityProcess | null = null;
  private health: CoreHealth = 'stopped';
  private restarts = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private opts: CoreSupervisorOptions) {}

  getHealth(): CoreHealth {
    return this.health;
  }

  start() {
    this.restarts = 0;
    this.spawn();
  }

  stop() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.child?.kill();
    this.child = null;
    this.setHealth('stopped');
  }

  restart() {
    this.stop();
    this.start();
  }

  /** Sends a ToCore message to the running core. No-op if no child is currently up (e.g. mid-restart backoff) -- the caller doesn't need to track supervisor state to know when this is safe to call. */
  sendToCore(msg: unknown) {
    this.child?.postMessage(msg);
  }

  private spawn() {
    this.setHealth('starting');
    const fork = this.opts.fork ?? defaultFork;
    const child = fork(this.opts.coreHostPath, [], {
      env: { ...process.env, ...this.opts.extraEnv?.(), DESK_AGENT_CONFIG_PATH: this.opts.configPath },
      stdio: 'pipe',
    });
    // Raw stdout/stderr, distinct from the core's structured ControlChannel
    // logs (which only exist once the core is far enough along to construct
    // its ControlChannel) -- this is what surfaces a boot-time crash (e.g. a
    // missing module inside the packaged asar) that never reaches that far.
    child.stderr?.on('data', (d: Buffer) => {
      const text = d.toString();
      console.error('[core]', text);
      this.opts.onStderr?.(text);
    });
    this.child = child;

    child.on('spawn', () => {
      this.setHealth('running');
    });

    child.on('message', (msg: unknown) => {
      // Same identity guard as the 'exit' handler below: ignore a message
      // from a child we've already moved past (stopped or superseded by a
      // restart), rather than forwarding stale ControlChannel data.
      if (this.child !== child) return;
      this.opts.onMessage?.(msg);
    });

    child.on('exit', (code: number) => {
      // Identity check, not a "did we intentionally stop?" flag: kill() is
      // fire-and-forget, so a killed child's 'exit' event can arrive after
      // stop()/restart() has already moved this.child on to null or to a
      // brand-new spawned child. This guard subsumes the old
      // stoppedIntentionally check (stop() nulls this.child, so a stale
      // event from the killed child never matches) and additionally covers
      // restart(), where this.child has already moved on to a NEW child by
      // the time the old one's exit arrives -- without this, that stale
      // event would null out the reference to the new, healthy child and
      // schedule a spurious extra spawn.
      if (this.child !== child) return;
      this.child = null;

      const maxRestarts = this.opts.maxRestarts ?? 5;
      this.restarts += 1;
      if (this.restarts > maxRestarts) {
        this.setHealth('crashed');
        return;
      }
      this.setHealth('starting');
      const backoffMs = Math.min(1000 * 2 ** (this.restarts - 1), 30000);
      this.restartTimer = setTimeout(() => this.spawn(), backoffMs);
    });
  }

  private setHealth(health: CoreHealth) {
    this.health = health;
    this.opts.onHealthChange?.(health);
  }
}
