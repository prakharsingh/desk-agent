# How to write a plugin

Plugins are how the core agent grows capabilities: each one runs in its own
`worker_thread`, declares the permissions it needs, and talks to the world
only through a capability object (`ctx`). This guide builds a working plugin
from scratch. Skim [`packages/plugin-sdk/README.md`](../../packages/plugin-sdk/README.md)
for the API reference and [`packages/plugins/README.md`](../../packages/plugins/README.md)
for the three shipped examples.

## 0. What a plugin can and cannot do

Can: poll an API, run allowlisted OS commands, publish widgets to the phone,
publish events onto the core's event bus, react to events and to
phone-initiated actions.

Cannot: import `child_process`/`net`/`fs` directly (nothing stops you
technically — `worker_threads` is fault isolation, not a sandbox — but it's
the one thing code review will always reject; the repo's isolation model
depends on plugins never bypassing `ctx`), run arbitrary commands (exec is
allowlisted per permission), or ship UI code to the phone (widgets are
declarative `{type, props}`; the phone renders from its own fixed set of
renderers — see [adding-a-widget.md](adding-a-widget.md)).

## 1. Scaffold the package

Create `packages/plugins/hello/` mirroring an existing plugin:

```
packages/plugins/hello/
  package.json        name "@desk-agent/plugin-hello", type module,
                      main dist/index.js, build script "tsc -p tsconfig.json"
  tsconfig.json       extends ../../../tsconfig.base.json
  src/
    index.ts
    index.test.ts
```

Copy `packages/plugins/weather/package.json` and adjust the name — the
dependencies (`@desk-agent/plugin-sdk`, `@desk-agent/protocol` as
`workspace:*`) are the same for every plugin.

## 2. Write the failing test first

This repo is TDD throughout; plugins are the easiest place to honor that
because the SDK ships a fake host:

```ts
// src/index.test.ts
import { describe, expect, it } from 'vitest';
import { createFakeHost } from '@desk-agent/plugin-sdk';
import plugin from './index.js';

describe('hello plugin', () => {
  it('publishes its widget on init', async () => {
    const host = createFakeHost(plugin);
    await host.init();
    expect(host.recorder.publishedWidgets).toContainEqual({
      widgetId: 'hello',
      widget: { type: 'hello', props: { message: 'hello, desk' } },
    });
  });

  it('is denied network access it did not declare', async () => {
    const host = createFakeHost(plugin, { grantedPermissions: [] });
    await host.init();
    // assert on host.recorder.deniedCalls for the negative path
  });
});
```

`createFakeHost` reproduces the real permission gating and records every
`publishWidget` / `publishEvent` / `log` / denial, so you never need to boot
the core to test plugin logic.

## 3. Implement the plugin

Two authoring shapes:

**Plain instance** (no config needed — like `system-stats`, `energy-saver`):

```ts
// src/index.ts
import type { Ctx, Plugin } from '@desk-agent/plugin-sdk';

let ctx: Ctx;
const widget = { type: 'hello', props: { message: 'hello, desk' } };

const plugin: Plugin = {
  id: 'hello',
  permissions: [],           // declare ONLY what you use
  init(context) {
    ctx = context;
    ctx.publishWidget('hello', widget);
    // for polling: ctx.timer.setInterval(() => { ... }, 60_000);
  },
  getWidgets() {
    return [widget];         // called on every phone connect — return current
                             // cached state, never placeholders
  },
  onAction(action, args) {}, // phone-initiated action.invoke lands here
  onEvent(eventName, data) {}, // core events (e.g. person_present) land here
};

export default plugin;
```

**Factory** (when the plugin takes config — like `weather`):

```ts
export function createPlugin(config: { location: string }): Plugin { ... }
```

The worker picks `createPlugin(config)` over `default` when both exist. The
config value it receives is the `config.json` block named by your registry
entry's `configKey` (step 5).

### The `ctx` surface

| Call | Gated by | Notes |
|---|---|---|
| `ctx.http.fetch(url, init)` | `net:*` permission | denied → synthetic 403 `Response` |
| `ctx.exec.run(cmd, args)` | per-permission **command allowlist** | denied → `{ code: 1, stderr: 'permission denied…' }`; runs via `execFile`, no shell |
| `ctx.publishWidget(id, widget)` | — | pushes a `widget.update` frame to the phone |
| `ctx.publishEvent(name, data)` | — | onto the core event bus (e.g. for automations) |
| `ctx.timer.setInterval/clearInterval` | — | use these, not bare globals |
| `ctx.log(level, msg)` | — | surfaces in core logs and the Mac app's Logs pane |

If your plugin needs an OS command no existing permission unlocks, add an
entry to `EXEC_ALLOWLIST` in `packages/core/src/permissionEnforcer.ts` (and
its test) pinning the exact command + first argument. That allowlist is the
security boundary — a new entry there gets more review scrutiny than the
plugin itself.

## 4. Know the runtime contract

- `init(ctx)` runs once after the worker imports your module. Kick off
  intervals here; async is fine.
- The host restarts a crashed worker with exponential backoff and gives up
  (status `failed`) after 5 crashes. A `getWidgets()` that takes longer than
  3 s gets your worker terminated and marked `degraded` — keep it
  synchronous-fast by returning cached state.
- Handler exceptions (`onAction`/`onEvent`) are caught and logged, not fatal.
- Workers get a 128 MB heap cap. This is fault isolation for JS-level
  errors — a native segfault still takes down the whole process.

## 5. Register and enable it

1. Add the package as a dependency of `@desk-agent/core`
   (`packages/core/package.json`).
2. Register it in `resolvePluginRegistry()` in `packages/core/src/main.ts`:

   ```ts
   'hello': {
     modulePath: require.resolve('@desk-agent/plugin-hello'),
     permissions: [],            // what the HOST grants — the enforcer uses
                                 // this, not what the plugin claims
     // configKey: 'hello',      // only if it takes a config block
   },
   ```

3. Add `'hello'` to `enabledPlugins` in your `config.json` (and to the
   schema default in `packages/config-schema/src/index.ts` if it should be
   on out of the box — plus a config sub-schema there if it takes config).

## 6. Build, test, see it live

```bash
pnpm build && pnpm test          # both must be green
node packages/core/dist/main.js  # watch your plugin's worker start
```

If your widget should show on the phone, remember the phone only renders
widget types it knows — a brand-new `type` renders as a "broken" card until
you follow [adding-a-widget.md](adding-a-widget.md).

## 7. Before you open the PR

- Tests written first, both runners green (`pnpm build && pnpm test`).
- Permissions minimal; any new allowlist entry justified in the PR
  description.
- No direct Node API imports in the plugin.
- See [CONTRIBUTING.md](../../CONTRIBUTING.md) for the general bar.
