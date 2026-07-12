import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Widget } from '@desk-agent/protocol';
import type { Permission } from '@desk-agent/plugin-sdk';

export interface PluginSpec {
  id: string;
  modulePath: string;
  permissions: Permission[];
  config?: unknown;
}

export function buildWorkerData(spec: PluginSpec) {
  return { pluginModulePath: spec.modulePath, grantedPermissions: spec.permissions, pluginConfig: spec.config };
}

export type PluginStatus = 'starting' | 'running' | 'degraded' | 'failed';

export interface WorkerLike {
  postMessage(msg: unknown): void;
  on(event: 'message' | 'error' | 'exit', handler: (...args: any[]) => void): void;
  terminate(): Promise<number>;
}

export interface WorkerHostOptions {
  maxOldGenerationSizeMb: number;
  maxRestarts: number;
  callTimeoutMs: number;
  onLog: (pluginId: string, level: string, message: string) => void;
  onEventPublish: (raw: unknown) => void;
  onWidgetPublish: (widgetId: string, raw: unknown) => void;
  createWorker?: (spec: PluginSpec) => WorkerLike;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class WorkerHost {
  private workers = new Map<string, WorkerLike>();
  private restarts = new Map<string, number>();
  private status = new Map<string, PluginStatus>();
  private pendingResolvers = new Map<string, (msg: any) => void>();
  private requestCounter = 0;

  constructor(private specs: PluginSpec[], private opts: WorkerHostOptions) {}

  async start() {
    for (const spec of this.specs) this.spawn(spec);
  }

  private defaultCreateWorker(spec: PluginSpec): WorkerLike {
    return new Worker(path.join(__dirname, 'workerEntry.js'), {
      workerData: buildWorkerData(spec),
      resourceLimits: { maxOldGenerationSizeMb: this.opts.maxOldGenerationSizeMb },
    }) as unknown as WorkerLike;
  }

  private spawn(spec: PluginSpec) {
    this.status.set(spec.id, 'starting');
    const worker = (this.opts.createWorker ?? this.defaultCreateWorker.bind(this))(spec);

    worker.on('message', (msg) => {
      if (msg.kind === 'ready') {
        this.status.set(spec.id, 'running');
      } else if (msg.kind === 'log') {
        this.opts.onLog(spec.id, msg.level, msg.message);
      } else if (msg.kind === 'publishEvent') {
        this.opts.onEventPublish({ eventName: msg.eventName, data: msg.data });
      } else if (msg.kind === 'publishWidget') {
        this.opts.onWidgetPublish(msg.widgetId, msg.widget);
      } else if (msg.kind === 'getWidgetsResult') {
        this.pendingResolvers.get(msg.requestId)?.(msg);
        this.pendingResolvers.delete(msg.requestId);
      }
    });

    worker.on('error', (err) => {
      this.opts.onLog(spec.id, 'error', `worker crashed: ${String(err)}`);
    });
    worker.on('exit', (code: number) => {
      if (code !== 0 && this.status.get(spec.id) !== 'failed' && this.status.get(spec.id) !== 'degraded') {
        this.handleCrash(spec);
      }
    });

    this.workers.set(spec.id, worker);
  }

  private handleCrash(spec: PluginSpec) {
    const count = (this.restarts.get(spec.id) ?? 0) + 1;
    this.restarts.set(spec.id, count);
    if (count > this.opts.maxRestarts) {
      this.status.set(spec.id, 'failed');
      this.opts.onLog(spec.id, 'error', `plugin ${spec.id} exceeded max restarts (${this.opts.maxRestarts}), marking failed`);
      return;
    }
    const backoffMs = Math.min(1000 * 2 ** (count - 1), 30000);
    setTimeout(() => this.spawn(spec), backoffMs);
  }

  async getWidgets(pluginId: string): Promise<Widget[]> {
    const worker = this.workers.get(pluginId);
    if (!worker || this.status.get(pluginId) !== 'running') return [];
    const requestId = String(this.requestCounter++);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingResolvers.delete(requestId);
        this.terminateAndDegrade(pluginId);
        resolve([]);
      }, this.opts.callTimeoutMs);
      this.pendingResolvers.set(requestId, (msg) => {
        clearTimeout(timer);
        resolve(msg.widgets ?? []);
      });
      worker.postMessage({ kind: 'getWidgets', requestId });
    });
  }

  invokeAction(pluginId: string, action: string, args?: Record<string, unknown>) {
    const worker = this.workers.get(pluginId);
    if (!worker || this.status.get(pluginId) !== 'running') return;
    worker.postMessage({ kind: 'onAction', action, args });
  }

  publishEventToPlugin(pluginId: string, eventName: string, data: Record<string, unknown>) {
    const worker = this.workers.get(pluginId);
    if (!worker || this.status.get(pluginId) !== 'running') return;
    worker.postMessage({ kind: 'onEvent', eventName, data });
  }

  private terminateAndDegrade(pluginId: string) {
    const worker = this.workers.get(pluginId);
    this.status.set(pluginId, 'degraded');
    void worker?.terminate();
    this.opts.onLog(pluginId, 'error', `plugin ${pluginId} exceeded call deadline, terminated and marked degraded`);
  }

  getStatus(pluginId: string): PluginStatus | undefined {
    return this.status.get(pluginId);
  }
}
