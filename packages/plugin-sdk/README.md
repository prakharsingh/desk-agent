# @desk-agent/plugin-sdk

The contract between a plugin and the core host: the `Plugin` interface, the
capability object (`Ctx`) plugins use to reach the outside world, the
`Permission` union, and a fake host harness for writing plugin tests without
booting the real core.

If you're here to build a plugin, read
**[docs/guides/writing-a-plugin.md](../../docs/guides/writing-a-plugin.md)**
— it walks through the whole thing end to end. This README is the API
reference summary.

## The two interfaces that matter

```ts
export interface Plugin {
  id: string;
  permissions: Permission[];
  init(ctx: Ctx): void | Promise<void>;
  getWidgets(): Widget[] | Promise<Widget[]>;
  onAction(action: string, args?: Record<string, unknown>): void | Promise<void>;
  onEvent(eventName: string, data: Record<string, unknown>): void | Promise<void>;
}

export interface Ctx {
  http: { fetch(url: string, init?: RequestInit): Promise<Response> };
  timer: {
    setInterval(fn: () => void, ms: number): NodeJS.Timeout;
    clearInterval(handle: NodeJS.Timeout): void;
  };
  log(level: LogLevel, message: string): void;
  publishEvent(eventName: string, data: Record<string, unknown>): void;
  publishWidget(widgetId: string, widget: Widget): void;
  exec: { run(command: string, args: string[]): Promise<ExecResult> };
}
```

A plugin module exports either a plain `default` `Plugin` instance
(system-stats, energy-saver do this) or a `createPlugin(config)` factory
(weather does this — the factory form is how a plugin receives its
`config.json` block).

## The security model, in one paragraph

Plugins run in their own `worker_thread` and may touch the network and the
OS **only** through `ctx`. Every `ctx.http.fetch` and `ctx.exec.run` call is
checked against the plugin's declared `permissions` array by the host's
permission enforcer (`packages/core/src/permissionEnforcer.ts`). `exec.run`
is further pinned to a per-permission **command allowlist** — e.g.
`sys:read-stats` unlocks only `pmset -g`, `nowplaying-cli get`, and
`pgrep -i`; nothing unlocks arbitrary commands. A denied `fetch` gets a
synthetic 403 `Response`; a denied `exec.run` gets
`{ code: 1, stderr: 'permission denied…' }`. A plugin that needs a new
command needs a new allowlist entry plus a test — never a broader
permission, and never a direct `import('child_process')` (that bypass is the
one thing CONTRIBUTING.md says reviewers will always reject).

Current `Permission` values: `'net:api.weather'`, `'sys:read-stats'`,
`'sys:control-display'`, `'sys:control-media'`.

## Testing plugins: `createFakeHost`

```ts
import { createFakeHost } from '@desk-agent/plugin-sdk';

const host = createFakeHost(myPlugin); // grants the plugin's own declared permissions by default
await host.init();
await host.onEvent('person_present', { present: false });

host.recorder.publishedWidgets; // every ctx.publishWidget call
host.recorder.publishedEvents;  // every ctx.publishEvent call
host.recorder.deniedCalls;      // permission denials, so you can test the negative path
```

The fake host reproduces the real gating (pass
`{ grantedPermissions: [] }` to test denial behavior), records logs and
publishes, and stubs `exec.run` when granted. See
`packages/plugins/*/src/index.test.ts` for real examples.

## Build & test

```bash
pnpm --filter @desk-agent/plugin-sdk build
pnpm test        # root vitest includes this package's tests
```
