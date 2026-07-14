# Desk Agent phone app

The React Native (0.86, New Architecture) Android app that turns a docked
phone into the desk display and honest presence sensor. It renders widgets
the Mac core pushes to it, and reports edge-triggered `sensor.*` signals
derived from on-device MLKit face detection — camera frames never leave the
phone.

Android-only by design: the target is a permanently docked phone, not a
mobile client. There is no iOS project and building doesn't need Xcode.

## Run it

```bash
# from the repo root, once: pnpm install && pnpm build
cd apps/android
pnpm android        # react-native run-android — builds & installs the debug APK
```

The app connects to `ws://localhost:8787`, which reaches the Mac through the
`adb reverse` tunnel the core's tunnel supervisor maintains — dock the phone
with the core running and it connects (and, by default, the core auto-launches
the app on dock). Full hardware walkthrough: **[SETUP.md](../../SETUP.md)**.
Before trusting it long-term on an aggressive OEM ROM, do the manual steps in
**[android-notes/RELIABILITY.md](android-notes/RELIABILITY.md)** — battery
optimization and autostart allowlisting cannot be set from code.

> **Where's the auto-launch code?** Not here. There's no USB/dock intent
> filter in the manifest — the *Mac* launches the app (`adb shell am start`)
> after re-issuing the tunnel on device attach. The app's only role is being
> `singleTask` and kiosk-friendly (`FLAG_KEEP_SCREEN_ON`, immersive bars).

## Source map

```
src/
  App.tsx              top-level state owner: WS client wiring, widget store,
                       screen-state reducer, screensaver + visibility sync
  wsClient.ts          WebSocket client: hello handshake, heartbeat echo,
                       exponential backoff reconnect, 15 s inbound watchdog
  presenceEvents.ts    builders for the sensor.* wire frames
  presence/            the camera pipeline (see below)
  widgets/             widget.type → renderer resolution (unknown → 'broken')
  display/             the multi-screen dashboard UI
    screens.ts           hand-rolled screen reducer (no React Navigation)
    AppShell.tsx         layout, screen switch, auto-idle timer
    HomeScreen.tsx       widget cards, gated by Mac-configured visibleWidgets
    screens/             detail screens: System, Weather, NowPlaying,
                         Presence, Clock, Light (Chin Light), Idle
                         (screensaver), Standby, Settings
    ui/                  Card, StatBar, Sparkline, AreaChart, Badge, Toggle…
    screensaverConfig.ts AsyncStorage-persisted screensaver config
    autoIdle.ts          pure auto-idle policy
android/               native project: foreground service, Brightness +
                       PresenceService native modules, kiosk MainActivity
```

### The presence pipeline (`src/presence/`)

`CameraPresence.tsx` hosts a persistently-mounted VisionCamera v5 front
camera (memoized — re-mounting it leaks JNI references). Each frame flows
through a worklet frame processor running MLKit face detection
(`frameProcessor.ts`, `pixelFormat: 'yuv'` is mandatory for MLKit), then two
**pure, fully unit-tested** functions:

- `signalDeriver.ts` — per-frame observation → `{ faceVisible, gazeAtScreen,
  motionActive }` (yaw ≤ 18°, pitch ≤ 20°, eye-open ≥ 0.5; motion from bbox
  centroid delta, no raw pixel access).
- `edgeEmitter.ts` — booleans → debounced, transition-only events (2 s min
  dwell). The phone never sends "person present"; it sends what the camera
  literally observed. All fusion happens Mac-side in
  `packages/core/src/presenceEngine.ts`.

Camera privacy is a real teardown: the privacy switch unmounts `<Camera>` so
the OS releases the capture session (green dot off) — never just a
stop-processing mute. `sensor.camera_state` reports `active | released |
error` so the Mac can fail safe.

### Screensaver

On by default with a 2-minute grace; configurable (on/off + 1/2/5/10/30 min)
from the phone's Settings screen or the Mac app's Device pane. The phone is
the source of truth (AsyncStorage); the Mac mirrors it. Remote changes arrive
as an `action.invoke` to the sentinel plugin id `phone-display`; the applied
config is reported back via `event.publish`.

## Tests

Three runners, split on purpose — see AGENTS.md for the full rationale:

```bash
pnpm test                 # repo root — Vitest, all pure-logic .test.ts (incl. apps/android/src/**)
cd apps/android && pnpm test:components   # Jest, RN component .test.tsx (render/interaction)
cd apps/android/android && ./gradlew :app:testDebugUnitTest # JUnit + MockK + Robolectric for the Kotlin modules
```

Pure logic belongs in a `.ts` + Vitest test; reach for a `.tsx` Jest test
only for genuinely view-level behavior. In the installed
`@testing-library/react-native`, `render()` and `fireEvent.press()` are both
**async** — forgetting `await` silently reads a stale tree.

## Native build notes

- minSdk 24, target/compile SDK 36, `applicationId com.deskagentapp`.
- The VisionCamera chain (`react-native-vision-camera` +
  `react-native-nitro-modules` + `react-native-vision-camera-worklets`) is a
  version-alignment story — check `package.json` for the pinned known-good
  combination before bumping any one of them.
- If Metro runs on a non-default port, pass
  `-PreactNativeDevServerPort=<port>` to any `gradlew app:installDebug` —
  otherwise the APK silently bakes in 8081 and renders a stale bundle with
  no visible error.
