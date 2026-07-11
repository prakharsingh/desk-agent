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
| `widget.update` | Mac → phone | `{ widgets: [{ widgetId, widget: { type, props } }] }` | Patches one or more dashboard widgets. |
| `action.invoke` | phone → Mac | `{ pluginId, action, args? }` | Phone-initiated action call into a plugin (e.g. manual override). |
| `event.publish` | either direction | `{ eventName, data }` | Generic typed event envelope — carries the `sensor.*` events below and `person_present`/`automation.override`. |

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
| `automation.override` | manual-override payload | phone (user toggles automation on/off) |

## Adding a new event

1. Add its Zod payload schema + exported type in `schema.ts`.
2. If it's a sensor event, add it to the `SensorEventName` union and the
   `SENSOR_SCHEMAS` map so `parseSensorEvent` covers it.
3. Add a builder in `presenceEvents.ts` (phone) if the phone emits it.
4. Write the schema test first (see `schema.test.ts` for the existing
   pattern) — this package is TDD like the rest of the repo.

Only bump `PROTOCOL_VERSION` for an actual breaking change to the envelope or
an existing payload shape — a new additive event does not require a bump.
