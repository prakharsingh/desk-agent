import type { Widget } from '@desk-agent/protocol';

export type Permission = 'net:api.weather' | 'sys:read-stats' | 'sys:control-display' | 'sys:control-media';

export type LogLevel = 'info' | 'warn' | 'error';

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface Ctx {
  http: {
    fetch(url: string, init?: RequestInit): Promise<Response>;
  };
  timer: {
    setInterval(fn: () => void, ms: number): NodeJS.Timeout;
    clearInterval(handle: NodeJS.Timeout): void;
  };
  log(level: LogLevel, message: string): void;
  publishEvent(eventName: string, data: Record<string, unknown>): void;
  publishWidget(widgetId: string, widget: Widget): void;
  exec: {
    run(command: string, args: string[]): Promise<ExecResult>;
  };
}

export interface Plugin {
  id: string;
  permissions: Permission[];
  init(ctx: Ctx): void | Promise<void>;
  getWidgets(): Widget[] | Promise<Widget[]>;
  onAction(action: string, args?: Record<string, unknown>): void | Promise<void>;
  onEvent(eventName: string, data: Record<string, unknown>): void | Promise<void>;
}
