# Android Reliability — manual setup (Slice 1a)

These cannot be set programmatically; perform once per device.

1. **Keep-awake**: `FLAG_KEEP_SCREEN_ON` is set on the main activity's window
   while it is foreground (native `MainActivity.onCreate`:
   `getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)`).
2. **Foreground service**: the WS client loop runs under a foreground service
   with a persistent notification. Declare an Android 14+
   `android:foregroundServiceType` scoped to what 1a needs (e.g.
   `dataSync` or `connectedDevice` — no `camera` type until Slice 1b).
3. **Battery optimization**: disable for this app
   (Settings → Apps → Desk Agent → Battery → Unrestricted).
4. **OEM autostart / protected-app allowlist**: enable for this app.
   Varies by OEM — Xiaomi (Security app → Autostart), Samsung (Device care →
   Battery → unmonitored apps), Huawei (Phone Manager → Protected apps),
   Oppo/Realme (Battery → Allow background activity).
5. **Mac-side watchdog** (Task 21) observes missed heartbeats — it cannot
   revive an OEM-killed app, only surface that it died.

Record the exact phone make + Android/OEM version and Mac model + macOS
version here before Slice 1b (see spec Open Items).
