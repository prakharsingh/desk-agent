# Protocol Reference

The wire format both the Mac core and the phone app speak, defined once in
`packages/protocol/src/schema.ts` as Zod schemas and imported by both sides —
never hand-copy a shape; import the type. Current `PROTOCOL_VERSION = 1`.

## Frame envelope

Every WebSocket message is a `Frame`:

```ts
{ v: number, type: string, id: string, ts: number, payload: <type-specific> }
```

`v` must equal `PROTOCOL_VERSION` or the frame is rejected. `type` is a
discriminated union tag; `FrameSchema` validates the full envelope +
payload shape together.

## Frame types

| `type` | Direction | Payload | Purpose |
|---|---|---|---|
| `hello` | phone → Mac | `{ clientVersion: string }` | Initial handshake on connect; Mac replies with the full dashboard layout + widget snapshot. |
| `heartbeat` | Mac → phone | `{}` | Periodic liveness ping; the phone ACKs it (echoes a `heartbeat` frame back), which the Mac's `Watchdog` uses as a sensor-activity-independent liveness signal. |
| `widget.update` | Mac → phone | `{ widgets: [{ widgetId, widget: { type, props } }], visibleWidgets?: string[] }` | Patches one or more dashboard widgets. `visibleWidgets` (which Home-screen tiles to show, ids from `WIDGET_IDS`) is present **only** on the `hello`-reply snapshot — its absence on later pushes means "no visibility change". |
| `action.invoke` | phone → Mac, and Mac → phone | `{ pluginId, action, args? }` | Phone-initiated action call into a plugin (e.g. media transport → `system-stats`). Also the Mac→phone command channel: an `action.invoke` with the sentinel `pluginId: 'phone-display'` and `action: 'setScreensaverConfig'` (payload validated by `ScreensaverConfigSchema`, `{ enabled, graceMs }`) is handled by the app itself and never reaches a plugin worker. |
| `event.publish` | either direction | `{ eventName, data }` | Generic typed event envelope — carries the `sensor.*` events below, `person_present`/`automation.override`, and `screensaver.config` (the phone reporting its applied screensaver config back; the phone is the source of truth, the Mac mirrors it). |

## Display frames (phone as extended display)

Dedicated frame types, not routed through the plugin `action.invoke` path.
Additive, so `PROTOCOL_VERSION` stays `1`. The video itself is **not** a
WebSocket frame: it is H.264 on a separate loopback socket (`DISPLAY_VIDEO_PORT`,
`8788`), reached through `adb reverse`, and authenticated with a per-session
token the core hands to the phone over `adb shell` (see
[Architecture](Architecture)).

| `type` | Direction | Payload | Purpose |
|---|---|---|---|
| `display.start` | phone → Mac | `{ w, h, orientation: 'portrait' \| 'landscape', dpi? }` | Asks for a session. `w`/`h` are the phone's physical pixels (320–8192); `dpi` only sizes the virtual display's physical size. |
| `display.stop` | phone → Mac | `{ sessionId: string \| null, reason?: string }` | Ends the session (or cancels a pending start when `sessionId` is `null`). |
| `display.session` | Mac → phone | `{ state: 'ready' \| 'ended' \| 'error', sessionId, videoPort?, reason? }` | Session state. `reason` is a free string on the wire; producers use the `DISPLAY_REASONS` values (for example `permission-screen-recording`, `display-offline`, `unsupported-host`, `no-device`). |

`'display'` is also a valid `visibleWidgets` id (`WIDGET_IDS`), which controls
the Home-screen Display tile.

## Sensor events (Slice 1b, carried inside `event.publish`)

Honest, edge-triggered signals only — emitted on transition, not per frame,
and only from the phone. All fusion happens Mac-side (see
[Architecture](Architecture)).

| `eventName` | Payload | Meaning |
|---|---|---|
| `sensor.face_visible` | `{ visible: boolean }` | ≥1 face entered/left frame |
| `sensor.gaze_at_screen` | `{ gazing: boolean }` | head-attention proxy on/off (not a real gaze vector — MLKit doesn't provide one) |
| `sensor.motion` | `{ active: boolean }` | motion-in-recent-window on/off |
| `sensor.camera_state` | `{ state: 'active' \| 'released' \| 'error', reason?: string }` | camera pipeline health / privacy state |

`parseSensorEvent(eventName, data)` in `packages/protocol` validates a
payload against the right schema for its `eventName` and returns a discriminated
`SensorEvent` union — use it rather than validating `sensor.*` payloads ad hoc.

## Derived / internal events

Not sent by the phone directly — produced Mac-side and carried the same way:

| `eventName` | Payload | Producer |
|---|---|---|
| `person_present` | `{ present: boolean }` | `PresenceEngine` (fusion of the four sensor events above) |
| `presence.returned` | — (Mac-internal only, never on the wire) | `PresenceEngine`, on a genuine sensor-driven absent→present edge; drives wake-on-return |
| `automation.override` | manual-override payload | phone (user toggles automation on/off) |
| `screensaver.config` | `{ enabled: boolean, graceMs: number }` | phone (reports its applied screensaver config, on change and on every reconnect) |

## Adding a new event

1. Add its Zod payload schema + exported type in `schema.ts`.
2. If it's a sensor event, add it to the `SensorEventName` union and the
   `SENSOR_SCHEMAS` map so `parseSensorEvent` covers it.
3. Add a builder in `presenceEvents.ts` (phone) if the phone emits it.
4. Write the schema test first (see `schema.test.ts` for the existing
   pattern) — this package is TDD like the rest of the repo.

Only bump `PROTOCOL_VERSION` for an actual breaking change to the envelope or
an existing payload shape — a new additive event does not require a bump.
