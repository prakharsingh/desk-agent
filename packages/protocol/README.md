# @desk-agent/protocol

The wire contract between the Mac core and the phone app, defined once as Zod
schemas and imported by both runtimes. **Never hand-copy a payload shape or an
event-name union** — import the type from this package (e.g.
`CameraStatePayload['state']` instead of re-declaring
`'active' | 'released' | 'error'`).

Deliberately dependency-light: only `zod`, no Node APIs, so it loads
identically in Node (core), Hermes (React Native app), and the Electron
renderer.

## What's in here

Everything lives in `src/schema.ts`:

- **`PROTOCOL_VERSION`** (currently `1`) — every frame's `v` field is
  validated as a literal against it. Only bump it for a breaking change to
  the envelope or an existing payload shape; additive new events don't
  require a bump (and bumping needlessly breaks every existing frame).
- **`FrameSchema`** — the envelope `{ v, type, id, ts, payload }`, a
  discriminated union over `type`: `hello`, `heartbeat`, `widget.update`,
  `action.invoke`, `event.publish`. Build frames with `createFrame(type,
  payload)` (frame ids avoid `crypto.randomUUID()` because Hermes doesn't
  have it); parse with `parseFrame(raw)`.
- **Sensor event schemas** — the honest, edge-triggered signals the phone
  emits inside `event.publish`: `sensor.face_visible`,
  `sensor.gaze_at_screen`, `sensor.motion`, `sensor.camera_state`. Validate
  with `parseSensorEvent(eventName, data)`, which returns a discriminated
  `SensorEvent` union — don't validate `sensor.*` payloads ad hoc.
- **`WIDGET_IDS`** — the canonical widget-tile catalog
  (`clock`, `system`, `weather`, `presence`, `playing`, `light`), the single
  source of truth for widget visibility (used by `visibleWidgets` in the
  config schema and the phone's Home screen).
- **`ScreensaverConfigSchema`** — `{ enabled, graceMs }`, the payload of the
  core→phone screensaver command (an `action.invoke` to the sentinel plugin
  id `phone-display`).
- Parse helpers returning `ParseResult<T>` (`{ok: true, value} | {ok: false,
  error}`): `parseFrame`, `parseWidget`, `parseEventPublishPayload`,
  `parseSensorEvent`, `parseScreensaverConfig`.

The full message-by-message reference, including the handshake flow and the
checklist for adding a new event, is on the
[Protocol Reference wiki page](https://github.com/prakharsingh/desk-agent/wiki/Protocol-Reference).

## Build & test

```bash
pnpm --filter @desk-agent/protocol build   # tsc → dist/
pnpm test                                  # root vitest run includes schema.test.ts
```

Downstream packages (and Vitest) resolve this package by its **built**
`dist/` output — run `pnpm build` at the repo root after changing the schema
or dependents will keep seeing the old shapes.

This package is TDD like the rest of the repo: add the schema test first
(see `src/schema.test.ts` for the pattern), then the schema.
