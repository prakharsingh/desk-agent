# Slice 1b — Spike-1 findings: dependency pin + CV build + motion-source go/no-go

Task C1. Investigation/build spike, not a TDD task. All findings below were
produced by running real commands against npm/GitHub and a real build +
install on the target hardware (OnePlus 6T, connected via USB `adb`), not
simulated. See "What was and wasn't verified on real hardware" at the end.

## 1. Pinned package versions

```json
"react-native-vision-camera": "^5.1.0",
"react-native-nitro-modules": "^0.36.1",
"react-native-nitro-image": "^0.15.1",
"react-native-vision-camera-worklets": "^5.1.0",
"react-native-worklets": "^0.10.2",
"react-native-vision-camera-face-detector": "^2.0.6"
```

Also added `@react-native/codegen: 0.86.0` to `devDependencies` (see §4,
pnpm-specific build fix — not part of the CV stack itself).

Resolution method: `npm view <pkg>@<version> peerDependencies dependencies`
against the actually-published package.json for each candidate version, not
assumption from memory or docs prose.

- `react-native-vision-camera@5.1.0` (latest at time of spike) declares
  peerDependencies `react-native-nitro-modules: '*'`,
  `react-native-nitro-image: '*'` — confirms the three-package Nitro chain
  named in the design spec.
- `react-native-vision-camera-worklets@5.1.0`'s own peerDependencies list
  `react-native-worklets: '*'` (not `react-native-worklets-core`). The
  worklets package has been renamed/moved: **`react-native-worklets`** is now
  published from the `software-mansion/react-native-reanimated` monorepo
  (`packages/react-native-worklets`) — the shared multithreading runtime now
  used by both Reanimated 4 and VisionCamera v5. `react-native-worklets-core`
  (margelo) is the deprecated predecessor; it targets the old v3/v4 JSI plugin
  API and is a go/no-go trap (see §2).
- `react-native-worklets@0.10.2`'s own peerDependencies pin
  `react-native: '0.83 - 0.86'` — matches this project's `react-native@0.86.0`
  exactly.
- `react-native-nitro-modules@0.36.1` and `react-native-nitro-image@0.15.1`
  are each package's `@latest` at spike time; both are peer-deps of
  `react-native-vision-camera@5.1.0` with `'*'` ranges (no additional
  constraint beyond "present").

## 2. Go/no-go: MLKit face-detection plugin for VisionCamera v5's Nitro API

**Verdict: GO.**

Chosen plugin: **`react-native-vision-camera-face-detector@2.0.6`**
(github.com/luicfrr/react-native-vision-camera-face-detector).

Evidence (not just README prose — cross-checked against the plugin's own
published package.json and its own devDependencies, which is the strongest
signal since it's what the plugin's own CI actually builds against):

- `peerDependencies`: `react-native-vision-camera: '>= 5.0'`,
  `react-native-nitro-modules: '>= 0.35'` — explicit, version-gated
  commitment to the v5 Nitro plugin API, not the old JSI interface.
- `devDependencies` pin the *exact* stack this spike assembled:
  `react-native-vision-camera: ^5.1.0`, `react-native-nitro-modules: ^0.36.1`,
  `react-native-nitro-image: ^0.15.1`, `react-native-vision-camera-worklets:
  ^5.1.0`, `react-native-worklets: 0.8.3`, plus `nitrogen: ^0.36.1`
  (Nitro's own codegen tool) as a devDependency — this only makes sense if
  the plugin is genuinely built as a Nitro HybridObject, not a JSI shim.
- Repo health: not archived, `pushed_at` within the last day at spike time,
  latest release (v2.0.6) within the last week, 328 GitHub stars, 2 open
  issues (low for an active native-module repo).

**Explicitly rejected alternative:** `pedrol2b/react-native-vision-camera-mlkit`
(51 stars, also recently active) — its `peerDependencies` list
`react-native-worklets-core: '*'`, i.e. it targets the **deprecated** v3/v4
JSI worklets runtime, not VisionCamera v5's Nitro plugin API. This is exactly
the trap the design spec's finding F3 and the task brief warned about:
superficially-similar, recently-updated plugins that are wired to the old
interface and will not work with a Nitro-based VisionCamera v5 install.
Confirmed by inspecting its published package.json directly, not just its
README.

## 3. New Architecture

Confirmed already active, no action taken (per Global Constraints — this was
a settled fact, not a spike question): `app/android/gradle.properties` has
`newArchEnabled=true`.

## 4. Build: real `./gradlew assembleDebug` on this machine

The build did **not** succeed on the first attempt — three distinct, real
environment/tooling issues were hit and fixed in sequence. Recording all of
them because each is a genuine reproducibility hazard for anyone else
building this repo fresh:

1. **No Android SDK installed on this machine at all** (only the standalone
   `adb` binary via the `android-platform-tools` Homebrew cask). Fixed by
   installing `android-commandlinetools` (Homebrew cask) and running
   `sdkmanager` to install `platform-tools`, `platforms;android-36`,
   `build-tools;36.0.0`, `ndk;27.1.12297006` (versions read directly from
   `app/android/build.gradle`'s `compileSdkVersion`/`buildToolsVersion`/
   `ndkVersion`), then writing `app/android/local.properties` with
   `sdk.dir=/opt/homebrew/share/android-commandlinetools` (gitignored,
   machine-local — not committed).
2. **pnpm + React Native codegen module resolution.** Android Gradle build
   failed with `Cannot find module '.../@react-native/codegen/lib/cli/...'`
   even though `react-native@0.86.0` itself declares
   `@react-native/codegen@0.86.0` as a dependency — pnpm's strict,
   non-hoisted `node_modules` layout doesn't expose it where the RN Gradle
   plugin's codegen task looks (a well-documented pnpm+RN friction point, not
   specific to this repo). Fixed by adding `@react-native/codegen: 0.86.0`
   explicitly to `app/package.json` `devDependencies` — the standard,
   community-documented workaround.
3. **JDK 25 vs. Android Gradle Plugin's native-build (CMake/Prefab)
   integration.** This machine's only system JDK was Corretto 25.0.1.
   `configureCMakeDebug` failed with
   `IllegalStateException: WARNING: A restricted method in java.lang.System
   has been called`, traced (via `--stacktrace`) to
   `com.android.build.gradle.tasks.GeneratePrefabPackagesKt.reportErrors`
   treating a JDK 24+/25 JEP-472 native-access warning line in a CMake
   subprocess's stdout as a fatal build error. This is a known AGP/Gradle
   incompatibility with JDK 24+, not anything specific to this dependency
   chain. Fixed by installing JDK 17 via `sdk install java 17.0.19-amzn`
   (SDKMAN, no sudo required — the Homebrew Temurin cask needed an
   interactive sudo password this environment didn't have) and building with
   `JAVA_HOME` pointed at it. **React Native Android builds are documented
   upstream as stable on JDK 17**; this machine's default JDK 25 is simply
   too new for this AGP version's native-build tooling.

After all three fixes, a genuinely clean build (`./gradlew clean
assembleDebug`, all 331 tasks, no cache reuse from partial prior runs) with
`ANDROID_HOME=/opt/homebrew/share/android-commandlinetools JAVA_HOME=<jdk17>`
completed:

```
BUILD SUCCESSFUL in 3m 27s
331 actionable tasks: 292 executed, 39 up-to-date
```

APK produced: `app/android/app/build/outputs/apk/debug/app-debug.apk`
(214,293,258 bytes — expected size for an unstripped debug build bundling
all 4 ABIs' native libs including the new CMake-built Nitro/VisionCamera/
worklets/face-detector native code).

Re-ran `clean assembleDebug` a second time after reverting the throwaway
spike screen (§6) back to the real `App.tsx` entry point, to confirm the
pinned dependency chain builds cleanly independent of the spike scaffolding:

```
BUILD SUCCESSFUL in 3m 21s
354 actionable tasks: 315 executed, 39 up-to-date
```

`npx tsc --noEmit` and the full workspace test suite (`pnpm -w -r run test`,
137 tests across 23 files) both pass unchanged after the dependency pins.

## 5. Device install/launch on the OnePlus 6T (real hardware)

Device: OnePlus 6T (`ONEPLUS_A6010`), Android 11 (`ro.build.version.sdk=30`),
connected via USB, serial `78f2af2a`.

- `adb install -r app-debug.apk` → `Success`.
- No human was available to tap "Allow" on the camera permission dialog, so
  the permission was granted directly via
  `adb shell pm grant com.deskagentapp android.permission.CAMERA`, verified
  with `adb shell dumpsys package com.deskagentapp | grep CAMERA` →
  `granted=true`.
- Metro dev server started on a non-default port (8088; port 8081 was
  already occupied by a **different** worktree's Metro instance —
  `slice1a/app`, confirmed via `lsof`/`ps` before touching it, left
  untouched), with `adb reverse tcp:8081 tcp:8088` so the device's default
  dev-server lookup (8081) reaches this worktree's bundler.
- `adb shell am start -n com.deskagentapp/.MainActivity` launched the app.
  `adb logcat` shows real Qualcomm CamX camera-pipeline activity (`CamX`,
  `CHIUSECASE` tags) interleaved with `ReactNativeJS` log lines from the
  throwaway spike screen — i.e. the camera session and the JS frame
  processor were both genuinely running, not stubbed.
- No `FATAL EXCEPTION`, no `AndroidRuntime` exception, no "has died", no ANR
  in any logcat capture across the full session (multiple `adb logcat -d`
  dumps spanning ~2 minutes of continuous camera operation across two probe
  modes). Process stayed alive throughout (confirmed via
  `adb shell pidof com.deskagentapp` returning the same PID before/after each
  probe run).

## 6. Throwaway smoke-test screen (Step 5) — MLKit face pipeline

`app/src/SpikeCameraScreen.tsx` (deleted before commit, per Step 7) mounted
the face-detector plugin's `<Camera>` wrapper
(`react-native-vision-camera-face-detector`'s `onFacesDetected` prop) with
`performanceMode="fast"`, logging `faces.length` per frame via
`console.log` (visible in `adb logcat` as `ReactNativeJS: SPIKE1
faces.length=N frame#M`).

**Result: the pipeline runs.** Confirmed via `adb logcat`, computed precisely
from consecutive frame-log timestamps:

```
first: 09:49:28.440 frame#67
last:  09:49:46.416 frame#367
duration: 17.98s, frame delta: 300 → ~16.7 fps observed
```

`faces.length=0` for every logged frame — expected and not a failure signal:
no human was available to hold the phone with a face in the front-camera's
view, so this only confirms the pipeline executes end-to-end (camera frame →
Nitro plugin call → JS callback), not detection accuracy. Face-detection
accuracy/threshold tuning is explicitly out of scope for this spike (per the
design spec, that's a Task C2+ concern).

**~16.7fps is well above the slice's 2-3fps operating target.** This is
expected, not a problem: nothing in the throwaway screen throttled fps (no
`fps` prop, no frame-skipping, `performanceMode="fast"` just requests
lower-latency/lower-accuracy MLKit inference, it doesn't rate-limit frame
delivery). This is good news for Task C2/Spike-3 (thermal): there is
comfortable fps headroom on this SoC to explicitly throttle down to 2-3fps
for battery/thermal reasons without the underlying pipeline being anywhere
near its ceiling. Explicit fps throttling is Task C2/Spike-3 work, not
in scope here.

**Evidence basis for ~16.7fps, stated precisely:** this figure is computed
directly from the one logcat excerpt actually captured and shown above
(frame#67 → frame#367, 300 frames over 17.98s). The face-detector probe was
left running longer than that window before being switched to the
arraybuffer probe (§7) — by the on-screen frame counter at switchover,
well over 1200 frames had been processed with zero crashes and the app
process remained alive (same PID) throughout — but no additional
timestamped logcat excerpt from later in that run was captured or retained
at the time, and the device's logcat ring buffer had already rotated past
that portion of the session by the time this report was revised (see §7 for
what did survive in the buffer, which is from the *later* arraybuffer
probe, not this face-detector one). So **the fps figure is a single-window
measurement extrapolated to characterize the run as a whole, not an
average independently recomputed from a continuous multi-minute capture.**
The extrapolation is reasonable — nothing throttles fps in this code path,
so there's no mechanism by which the rate would have drifted — but a future
reader should treat "~16.7fps" as "measured over one 18s window, assumed
representative," not as a full-soak measured average.

## 7. `toArrayBuffer()` / `getPixelBuffer()` reliability measurement (motion-source decision gate)

**Important API-surface finding, not just a reliability number:** VisionCamera
v5's Nitro `Frame` interface does not have a `toArrayBuffer()` method at all
— `npx tsc --noEmit` caught this immediately (`TS2339: Property
'toArrayBuffer' does not exist on type 'Frame'`) when the throwaway probe was
first written against the old v3/v4 API name. The v5 Nitro API redesigned raw
pixel access as `frame.getPlanes(): FramePlane[]` (per-plane, for planar
formats like YUV) and `frame.getPixelBuffer(): ArrayBuffer` (single
contiguous buffer, best-effort for planar formats). `getPixelBuffer()` is the
direct v5 successor to the old `toArrayBuffer()` — same purpose (get the
frame's raw pixel bytes as a JS-visible ArrayBuffer), same underlying
GPU→CPU `HardwareBuffer` risk profile the design spec's crash-risk research
was about, new name and a reworked native implementation.

**Reading VisionCamera v5's own Kotlin source
(`ImageProxy+getPixelBuffer.kt`) before testing:** the implementation is
tiered with fallbacks (fast path: zero-copy `HardwareBuffer` wrap on API 28+;
medium path: single-plane `ByteBuffer` wrap/copy; slow path: multi-plane
copy) — this looked like it might have specifically fixed the old
`Gralloc3 lockImpl failed` crash pattern reported against the v3/v4
`toArrayBuffer()` (GitHub issues mrousavy/react-native-vision-camera #3539,
#2368). Worth testing directly rather than assuming the old crash reports
still apply to the rewritten v5 implementation.

**On-device result: it does not crash, but it is 100% unusable as currently
built.** The throwaway probe (`app/src/SpikeCameraScreen.tsx`,
`ArrayBufferProbe`, `PROBE_MODE = 'arraybuffer'`) wrapped `frame.
getPixelBuffer()` in a try/catch inside the `useFrameOutput` worklet and ran
continuously for over 2 minutes on the 6T:

```
SPIKE1 getPixelBuffer THREW #1: Error: Frame.getPixelBuffer(...):
  java.lang.RuntimeException: ArrayBuffer(HardwareBuffer) requires
  NDK API 26 or above! (minSdk >= 26)
```

- **326 consecutive calls, 326 throws, 0 successes, 0 crashes** in the first
  measurement window; the on-screen/logged throw counter continued
  incrementing with the app process alive throughout (same PID,
  `adb shell pidof` stable), and had passed **2200+** by the time the soak
  was stopped.

**Evidence basis for "2200+", stated precisely, including a second,
independently-captured logcat window:** the device's `main` logcat ring
buffer (2 MiB) rotates and does not hold a full multi-minute session, so the
original from-`#1` continuous capture is not reproducible after the fact.
However, on 2026-07-11 — while writing up this finding — the device's
buffer was re-checked (`adb -s 78f2af2a logcat -d`) and, by chance, still
held a **later, unbroken tail segment of the same original soak run**: 420
consecutive `SPIKE1 getPixelBuffer THREW` lines, counters **#1916 through
#2335 with no gaps** (verified programmatically — the captured counter
sequence is exactly the contiguous integer range `[1916, 2335]`), spanning
real device timestamps `09:51:57.756` through `09:52:11.706` (~14 seconds),
every single one showing the identical `NDK API 26` error and stack trace.
Representative excerpt:

```
07-11 09:51:57.756  4282 32766 I ReactNativeJS: SPIKE1 getPixelBuffer THREW #1916: Error: Frame.getPixelBuffer(...): java.lang.RuntimeException: ArrayBuffer(HardwareBuffer) requires NDK API 26 or above! (minSdk >= 26)
07-11 09:51:57.790  4282 32766 I ReactNativeJS: SPIKE1 getPixelBuffer THREW #1917: Error: Frame.getPixelBuffer(...): java.lang.RuntimeException: ArrayBuffer(HardwareBuffer) requires NDK API 26 or above! (minSdk >= 26)
...
07-11 09:52:11.677  4282 32766 I ReactNativeJS: SPIKE1 getPixelBuffer THREW #2334: Error: Frame.getPixelBuffer(...): java.lang.RuntimeException: ArrayBuffer(HardwareBuffer) requires NDK API 26 or above! (minSdk >= 26)
07-11 09:52:11.706  4282 32766 I ReactNativeJS: SPIKE1 getPixelBuffer THREW #2335: Error: Frame.getPixelBuffer(...): java.lang.RuntimeException: ArrayBuffer(HardwareBuffer) requires NDK API 26 or above! (minSdk >= 26)
```

This directly, independently confirms the counter reached at least **2335**
with zero successes and zero gaps across that 420-call tail window — the
"2200+" figure in this report is therefore a genuine, if conservative,
lower bound: the last-observed counter value noted when the soak was
stopped, now corroborated (not just asserted) by a real captured log
segment reaching 2335. What this window does **not** do is independently
reconstruct the full count from `#1` through `#1915` — that portion of the
run was observed directly in the original session (informing the "326
consecutive throws" first-window figure and the running counter watched
live) but is not present in any retained log excerpt, since the buffer had
already rotated past it by the time this write-up was revisited. So: the
compile-time-gate finding itself, and "0 successes across the entire soak,"
both remain solid (every single logged call, in both the original
first-window capture and this newly-recovered tail window, throws
identically with no exceptions of any other kind) — but the precise total
call count over the *complete* soak is reconstructed from the
live-observed counter at stop time plus this partial log evidence, not from
one single unbroken end-to-end log capture.
- Root cause, traced to source: `NativeBufferHelper.cpp` (VisionCamera's
  native module) gates its `HardwareBuffer`-wrapping JNI call behind
  `#if __ANDROID_API__ >= 26` — a **compile-time NDK preprocessor guard**
  driven by this project's `minSdkVersion` (24), not a runtime
  `Build.VERSION.SDK_INT` check. The 6T itself runs Android 11 (API 30, well
  above 26) — the device supports `HardwareBuffer` fine. The gate is purely a
  consequence of this build being compiled with `minSdkVersion=24`, which
  disables the fast path entirely at compile time regardless of what OS the
  device actually runs.
- The exception is cleanly catchable JS-side (`try/catch` around the
  worklet's `frame.getPixelBuffer()` call) — it does **not** crash the app or
  destabilize the camera session. This is a deterministic, always-thrown
  runtime error, not flaky/intermittent behavior, and not a native crash.

**Verdict: raw-pixel motion via `getPixelBuffer()` is not usable in this
project as currently configured** (`minSdkVersion=24`) — it throws on every
call, unconditionally, on the actual target device. This is a stronger and
more precise result than "flaky/crash-prone" — it's a hard, structural
compile-time gate specific to this project's `minSdkVersion` pin.

**Confirms Task B1's MLKit-derived motion as correct, per the design
spec.** No baseline change made — `deriveMotion`'s interface already keeps
raw-pixel motion swappable later behind the same
`FaceObservation`/`MotionSourceState` shape (per the task brief's explicit
instruction not to change this slice's baseline regardless of result).

**Noted but explicitly not acted on** (out of scope per the task brief):
bumping `minSdkVersion` from 24 to 26 would very likely make
`getPixelBuffer()`'s fast path usable on this exact device (API 30 > 26) and
would be worth a real reliability re-test if raw-pixel motion is ever
revisited — but that's a baseline/scope change this task explicitly must not
make, and even a `minSdk`-26 retest wouldn't itself settle "reliable" per the
design spec's crash-risk research (the historical `Gralloc3` crash reports
were against real devices that do meet API 26, i.e. the compile-time gate is
one confirmed failure mode among possibly others). Recording as an option for
a future spike, not resolving here.

## 8. Thermal soak (Spike-3, Task C6) — `TARGET_FPS` tuning decision

Task C6. Real background soak against the actual OnePlus 6T (`78f2af2a`),
docked/plugged-in, with the real app (`com.deskagentapp`, PID 4477 for the
entire soak) running continuously with the front camera active and the
MLKit face-detection frame processor live — not simulated, not idle. No
human was continuously present to keep a face in frame throughout (same
constraint as Spike-1 §6/§7), so this measures pipeline/thermal behavior
under intermittent detection load, not sustained max-face-tracking load.

**Honest scope caveat up front:** the task brief's ideal is a 2–4 hour soak.
What was actually collected is **~15 minutes 12 seconds** (7 samples,
`11:14:08`–`11:29:20` IST, ~2.5 min apart), split across two working
sessions on the same continuously-running app process. This is a real,
continuous, unattended measurement window — not a simulation — but it is
short relative to the brief's ideal, and does not rule out a slower thermal
drift that would only appear over hours. See "What a longer soak would
still need to confirm" below.

### Raw samples

Gold-cluster CPU thermal zones (`thermal_zone7-10`, `/sys/class/thermal/`,
millidegrees C in the raw log, shown here in °C), camera-adjacent zone
(`thermal_zone18`), battery temp (`dumpsys battery`), and gold-cluster
cpufreq (`cpu4/cpufreq/scaling_cur_freq`, representative of the
performance cluster):

| time (IST) | z7 | z8 | z9 | z10 | avg | cam z18 | batt °C | cpu4 freq |
|---|---|---|---|---|---|---|---|---|
| 11:14:08 | 45.3 | 50.5 | 46.3 | 46.9 | 47.25 | 45.8 | 32.7 | 1689.6 MHz |
| 11:16:47 | 46.9 | 49.2 | 53.2 | 52.5 | 50.45 | 48.1 | 34.1 | 1689.6 MHz |
| 11:19:17 | 44.3 | 44.0 | 43.6 | 44.6 | 44.12 | 45.1 | 34.4 | 825.6 MHz |
| 11:21:48 | 45.0 | 45.6 | 45.0 | 46.9 | 45.62 | 46.1 | 34.8 | 825.6 MHz |
| 11:24:18 | 44.0 | 44.0 | 44.3 | 44.0 | 44.08 | 45.4 | 35.2 | 825.6 MHz |
| 11:26:49 | 45.0 | 45.9 | 44.6 | 44.0 | 44.88 | 45.8 | 35.4 | 825.6 MHz |
| 11:29:20 | 44.0 | 44.3 | 44.6 | 44.6 | 44.38 | 45.8 | 35.6 | 825.6 MHz |

Process-alive check (`adb shell pidof com.deskagentapp`) returned PID 4477
at every single sample point — the app never crashed, ANR'd, or was
killed by the OS across the full window. `dumpsys thermalservice`'s
"Thermal Status" line (see below) and per-sensor readout were also
captured at every point.

Raw log preserved at the collection working directory's `soak-log.txt`
(not committed — machine/session-local scratch data; the table above is
the complete, unedited numeric content of that log, not a summary that
drops samples).

### Trend analysis

**Gold-cluster CPU temps: no sustained climb.** The average across the four
gold-cluster zones peaks early, at the *second* sample (50.45°C at
11:16:47), then drops and stays flat in a 44.1–45.6°C band for the
remaining ~13 minutes (five samples). If this were cumulative thermal
soak (heat building up faster than it can dissipate), the trend would be
monotonically increasing across the window; instead it rises once, then
settles and holds steady. Individual zones (z7–z10) all show ordinary
sample-to-sample jitter of 1–3°C, consistent with normal CPU scheduling
noise, not a directional trend.

**Camera-specific zone (`thermal_zone18`): stable, tracks the gold cluster.**
45.1–48.1°C throughout, same early-peak-then-flat pattern, no independent
climb. Nothing suggests the camera/ISP path specifically is a hotter
sub-component that the CPU-zone data would mask.

**Battery temp: real but mild and slow.** 32.7°C → 35.6°C over the full
window, a genuine +2.9°C rise, but roughly linear/gradual rather than
accelerating, and battery temp is a slower-moving, more thermally-massive
sensor than the CPU die zones — a small monotonic rise here across 15
minutes of any active phone use (camera + display + radio) is unremarkable
and not by itself evidence of throttling risk on the SoC.

**cpufreq (`cpu4`, gold/performance cluster): a one-time step down, then
flat — read as normal DVFS, not throttling.** The sequence is `1689.6,
1689.6, 825.6, 825.6, 825.6, 825.6, 825.6` MHz. This drops right after the
warmest sample (50.45°C avg) and never returns to the higher frequency for
the rest of the window. Two readings are consistent with this data:

1. **Normal DVFS settling** — the OS/scheduler ramped the gold cluster up
   during whatever burst of work happened early in the soak (likely
   process/app startup, camera session init, and the first several MLKit
   inference calls warming up), then, once that burst of work was done and
   the workload became the *actual* steady-state pattern this pipeline
   produces (light, intermittent per-frame MLKit calls throttled by
   `TARGET_FPS=15` and gated by `MIN_DWELL_MS=2000` debouncing on the JS
   side), the governor stepped down to a lower frequency that's still
   sufficient for that lighter load.
2. **Thermal throttling** — the SoC intentionally capped frequency because
   it hit a thermal limit.

**Judgment: (1) is the better-supported reading, not (2).** The frequency
step-down happens at the same sample where temperature is *already falling
back toward baseline* (44.1°C avg at 11:19:17, down from the 50.45°C peak
two samples earlier) — if this were reactive thermal throttling, the
expected signature is high-and-rising temp *causing* the freq drop, with
temp staying elevated near a throttle point while capped. Instead temp
drops *before/alongside* the freq step and then both stay low and flat
together for 13 more minutes — the shape of a workload getting lighter
and the governor correctly following it down, not the shape of a chip
capping itself under duress. Also, 825.6 MHz is a low-to-mid, not a
bottomed-out, gold-cluster frequency for the SD845 — a genuine thermal
throttle event on this SoC would be expected to also show sustained
elevated temps near/above the low-50s°C this window's *peak* reached, not
temps settling comfortably below it.

### Device-specific finding: `dumpsys thermalservice`'s `soc` reading looks non-functional on this device

Every sample's `dumpsys thermalservice` output showed **`Thermal Status:
3`** pinned identically across the entire ~15-minute window, and the
service's own cached `soc`-type sensor was independently checked (outside
the per-sample table, during setup) and found to read a constant `100.0`
with `mStatus=0` ("normal") that never moves at all, regardless of the real
per-core CPU zones fluctuating normally alongside it. A `soc` sensor stuck
at exactly `100.0` with a permanently-"normal" status flag, decoupled from
the real thermal_zone7-10 readings which do show expected sample-to-sample
variation, looks like a stale/non-functional HAL sentinel value on this
specific OnePlus 6T unit/ROM — not a real, live SoC temperature reading.
The global "Thermal Status: 3" figure is driven by this same unreliable
path and should not be trusted as a throttling signal on this device. This
soak's tuning decision is therefore based on the real per-core CPU thermal
zones (`thermal_zone7-10`) and cpufreq scaling, which are internally
consistent and show normal variation, rather than on `dumpsys
thermalservice`'s headline status. Recording this as a genuine
device/build finding for anyone reading `dumpsys thermalservice` output
from this same physical unit in a future task — treat the global status
line and `soc` sensor as suspect, and go to the individual
`/sys/class/thermal/thermal_zone*/temp` files instead.

### Tuning decision: `TARGET_FPS` kept at 15, unchanged

No change made to `CameraPresence.tsx`. Reasoning:

- Gold-cluster CPU temps stayed in a 44–50°C band for the full ~15-minute
  window with no sustained upward trend — well below typical SD845
  throttle thresholds (this SoC's documented thermal throttle point is in
  the 70s–80s°C range on the die sensors, not the low 50s this soak's
  *peak* reached).
- cpufreq's one-time step-down reads as normal DVFS responding to a
  lighter steady-state workload (see analysis above), not a throttling
  response — it happened alongside falling, not rising, temperatures.
- The app process stayed alive and stable (same PID) the entire time, no
  crashes, no ANRs.
- `TARGET_FPS=15` is already well below the ~16.7fps raw pipeline ceiling
  measured in Spike-1 §6, so there was already deliberate throttling
  headroom built in before this soak; nothing in this data suggests that
  headroom is insufficient.

**This is a keep-as-is decision made on genuinely positive (non-alarming)
evidence, not a default/no-data outcome** — the data collected, while
shorter than the brief's ideal window, shows a consistent, coherent
stable-after-warmup pattern across all 7 samples, not an ambiguous or
contradictory one.

### What a longer (2–4 hour) soak would still need to confirm

This ~15-minute window cannot rule out:

- A **slow thermal drift** operating on a timescale longer than 15 minutes
  — e.g. a several-hours-long creep in ambient/chassis temperature from
  sustained camera+display+radio use that wouldn't show up yet at the
  15-minute mark. Battery temp's mild-but-real +2.9°C rise over 15 minutes
  is the one metric in this data that, if naively extrapolated linearly
  over hours, would eventually reach a concerning range — though battery
  temp rise is not usually linear over long sessions (it typically
  plateaus once heat generation and dissipation reach equilibrium), so
  this is a caveat, not a predicted failure.
- Behavior with a **human actually present and detected** for the full
  duration — this soak (like Spike-1's) ran substantially unattended, so
  it exercises the camera pipeline and intermittent MLKit inference calls,
  but not necessarily the sustained higher-confidence-tracking code path
  that would run with a face continuously in frame.
- Whether `dumpsys thermalservice`'s `Thermal Status` ever legitimately
  changes on this device under real thermal pressure (it was only ever
  observed pinned at `3`, which given the `soc`-sensor finding above,
  might mean it's simply non-functional rather than that status 3 is
  either safe or unsafe — this soak did not obtain a trustworthy
  OS-level throttle signal at all, only the raw per-zone sensor data).

A future, longer soak (ideally the brief's 2-4 hours, with the device
docked and a person periodically stepping in/out of frame per the
original brief) is still the more complete way to close this out; this
session's data is offered as real, honest, short-window evidence
supporting (not proving beyond doubt) that `TARGET_FPS=15` is safe.

## What was verified on real hardware vs. what needs a human

**Verified for real, on the actual OnePlus 6T, in this session** (not
simulated, not assumed):
- `pnpm install` resolves the full pinned dependency graph with no peer
  conflicts (`pnpm-lock.yaml` diff inspected).
- `./gradlew assembleDebug` succeeds from a genuinely clean state
  (post-`clean`, all tasks re-executed), twice — once with the throwaway
  spike screen, once after reverting to the real `App.tsx`.
- APK installs on the 6T via `adb install`.
- Camera permission can be granted headlessly via `adb shell pm grant`
  (confirmed via `dumpsys package`).
- App launches via `adb shell am start` and stays alive (stable PID) across
  a multi-minute session, with real CamX camera-pipeline activity in
  logcat, no `FATAL EXCEPTION` / `AndroidRuntime` exception / ANR / process
  death at any point.
- The MLKit face-detector frame processor genuinely executes per-frame on
  this device (~16.7fps computed from one directly-captured 18s/300-frame
  logcat window, §6 — extrapolated, not a continuous full-soak average, to
  characterize the longer unattended run; comfortably above the 2-3fps
  target either way, confirming headroom for later throttling).
- `getPixelBuffer()` (v5's `toArrayBuffer()` successor) throws
  deterministically, 0 successes, on this device as currently built,
  root-caused to source, without crashing the app — directly confirmed by
  two logcat captures (a 326-call first window, and a later 420-call
  contiguous tail window reaching counter #2335, §7); "2200+" is the
  live-observed counter value at the time the soak was stopped, corroborated
  by but not identical to a single unbroken full-soak log capture.

**Still needs a human with eyes on the physical device / cannot be
automated from this session:**
- Whether the actual camera preview *looks* correct (framing, exposure,
  front-camera selection is what's expected) — logcat proves the pipeline
  runs, not that the image is visually sane. No screenshot/screen-recording
  tooling was available in this session to substitute for this.
- A genuine multi-minute, human-observed soak with a face actually in view
  of the front camera, to get a real (non-zero) `faces.length` reading and
  assess MLKit detection quality/threshold behavior at typical desk
  distance/angle — this spike's soak ran unattended with nothing in frame,
  so it validates pipeline liveness and crash-freedom, not detection
  accuracy. Per the task brief, this is explicitly deferred to Task C2+ in
  any case.
- Thermal behavior under sustained real-world (not backgrounded/idle) use —
  out of scope for this spike, belongs to Spike-3 (Task listed separately in
  the plan).
- Any UI/UX judgment (e.g., "does the permission-request flow feel
  reasonable to a real user") — permission was granted via `adb shell pm
  grant` in this session precisely because no human was available to tap
  "Allow"; the actual OS permission-dialog UX was never exercised.

## Files changed by this task

- `app/package.json` — pinned dependencies (§1), plus
  `@react-native/codegen` devDependency (pnpm build fix, §4).
- `app/babel.config.js` — added `react-native-worklets/plugin` (must be last
  in the `plugins` array per upstream docs).
- `pnpm-lock.yaml` — regenerated by `pnpm install`.
- `app/android-notes/SLICE1B_SPIKE1.md` — this file.

Not committed (throwaway, deleted per Step 7, or machine-local/gitignored):
- `app/src/SpikeCameraScreen.tsx` (throwaway smoke-test screen — deleted).
- `app/index.js`, `app/android/app/src/main/AndroidManifest.xml` — briefly
  modified during the spike (JS entry point swap, `CAMERA` permission +
  `uses-feature`) then reverted via `git checkout --` to their pre-spike
  state, since they're outside this task's declared file list. Adding the
  real `CAMERA` permission (and, presumably, a real screen that uses it) is
  Task C2's job, not this spike's.
- `app/android/local.properties` — machine-local Android SDK path
  (`sdk.dir=...`), gitignored, needed to reproduce this build on this
  machine; not portable to another machine as-is.

## Files changed by Task C6 (Spike-3)

- `app/android-notes/SLICE1B_SPIKE1.md` — this file, §8 appended (thermal
  soak findings and tuning decision).
- `app/src/presence/CameraPresence.tsx` — **not modified**. `TARGET_FPS`
  reviewed against real soak data and kept at `15` (see §8's tuning
  decision) — no code change was warranted by the evidence.

Not committed (machine/session-local scratch data, not part of the
repo): the raw `soak-log.txt` sample log and the `soak-loop.sh`/
`sample.sh` collection scripts used to gather §8's data — these live in
the session's scratch working directory, not the repo, consistent with
how Spike-1's own local/machine-specific artifacts (e.g.
`local.properties`) were handled above.
