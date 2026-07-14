import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import type { Widget } from '@desk-agent/protocol';
import type { ConnectionState } from '../wsClient.js';
import type { SensorFrame } from './sensorFrame.js';
import { computePixelShiftOffset } from '../oledMitigation.js';
import { CameraPresence } from '../presence/CameraPresence.js';
import { theme } from './theme.js';
import { Header } from './Header.js';
import { HomeScreen } from './HomeScreen.js';
import { ClockScreen } from './screens/ClockScreen.js';
import { IdleScreen } from './screens/IdleScreen.js';
import { NowPlayingDetail } from './screens/NowPlayingDetail.js';
import { PresenceDetail } from './screens/PresenceDetail.js';
import { StandbyScreen } from './screens/StandbyScreen.js';
import { SystemDetail } from './screens/SystemDetail.js';
import { WeatherDetail } from './screens/WeatherDetail.js';
import { LightScreen } from './screens/LightScreen.js';
import type { LightColorPreset } from './lightColor.js';
import { readSystemStats, readWeather } from './widgetReaders.js';
import { derivePresence } from './derivePresence.js';
import { shouldAutoIdle } from './autoIdle.js';
import { pushHistory } from './sparkline.js';
import { STANDBY_VOICE, type ScreenState } from './screens.js';
import type { TemperatureUnit } from './temperature.js';

const AMPLITUDE_PX = 2;
const PERIOD_MS = 60000;
const HISTORY_MAX_LEN = 40;

// Local-inactivity grace period before AppShell auto-idles the display on its
// own (independent of any Mac-driven presence automation). Chosen as a
// deliberately generous 2 minutes so a person reading/glancing at the screen
// without touching it isn't punished with an unexpected sleep; short enough
// that an actually-abandoned desk display still self-idles for OLED safety
// well within a normal work session.
const GRACE_MS = 120000;
const ACTIVITY_CHECK_INTERVAL_MS = 2000;

export interface AppShellProps {
  widgets: Record<string, Widget>;
  connectionState: ConnectionState;
  sensorFrame: SensorFrame;
  cameraEnabled: boolean;
  setCameraEnabled: (enabled: boolean) => void;
  // Real automation.override state, sourced from App.tsx (Slice 1d on-device
  // fix). Kept optional/defaulted so any other future caller without a real
  // automation source still gets an honest read-only placeholder rather than
  // a prop-interface break.
  automationEnabled?: boolean;
  onToggleAutomation?: () => void;
  // Real media-control actions (system-stats plugin's togglePlayPause/next/
  // previous), sourced from App.tsx the same way onToggleAutomation is.
  onTogglePlayPause?: () => void;
  onNextTrack?: () => void;
  onPreviousTrack?: () => void;
  sendFrame: (json: string) => void;
  connectionEpoch: number;
  onSensor: (partial: Partial<SensorFrame>) => void;
  startedAt: number;
  now: number;
  screenState: ScreenState;
  onGoSystem: () => void;
  onGoWeather: () => void;
  onGoPlaying: () => void;
  onGoPresence: () => void;
  onGoClock: () => void;
  onGoVoice: () => void;
  onGoDeck: () => void;
  onGoLight: () => void;
  onBack: () => void;
  onSleep: () => void;
  onWake: () => void;
}

export function AppShell({
  widgets,
  connectionState,
  sensorFrame,
  cameraEnabled,
  setCameraEnabled,
  automationEnabled = false,
  onToggleAutomation,
  onTogglePlayPause,
  onNextTrack,
  onPreviousTrack,
  sendFrame,
  connectionEpoch,
  onSensor,
  startedAt,
  now,
  screenState,
  onGoSystem,
  onGoWeather,
  onGoPlaying,
  onGoPresence,
  onGoClock,
  onGoVoice,
  onGoDeck,
  onGoLight,
  onBack,
  onSleep,
  onWake,
}: AppShellProps) {
  const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // The Chin Light screen is a full-bleed, edge-to-edge solid colour used to
  // light a face on a video call, so it must NOT carry the pixel-shift drift:
  // any sub-pixel translation of the root exposes a sliver of the dark app
  // background along one edge (the "black gutter" bug) and defeats the whole
  // purpose of an even fill. The screen is also time-boxed (30 min) and
  // deliberately bright, so skipping OLED drift here is an acceptable trade.
  const immersiveLight = screenState.screen === 'light';

  // OLED pixel-shift drift wrapper, moved verbatim in spirit from App.tsx:
  // same constants, same computePixelShiftOffset, same 1s tick cadence.
  // Pinned to {0,0} while the immersive light screen is showing (see above).
  useEffect(() => {
    if (immersiveLight) {
      translate.setValue({ x: 0, y: 0 });
      return;
    }
    const interval = setInterval(() => {
      const offset = computePixelShiftOffset(Date.now() - startedAt, AMPLITUDE_PX, PERIOD_MS);
      translate.setValue(offset);
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt, translate, immersiveLight]);

  // Local auto-idle policy: track last local-interaction timestamp, reset by
  // a root touch responder, and periodically check whether enough silence
  // has elapsed to put the display to sleep on its own (independent of any
  // Mac-driven presence automation, which travels a separate path).
  const lastActivityRef = useRef(Date.now());
  const bumpActivity = () => {
    lastActivityRef.current = Date.now();
  };

  useEffect(() => {
    const interval = setInterval(() => {
      if (screenState.screen === 'idle') return; // already idle -- don't repeatedly call onSleep
      if (shouldAutoIdle(Date.now() - lastActivityRef.current, GRACE_MS)) {
        onSleep();
      }
    }, ACTIVITY_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [screenState.screen, onSleep]);

  // Sensor-driven wake: a fresh positive local signal (face or motion) while
  // idle should wake the display, in addition to IdleScreen's own
  // tap-to-wake (that screen's responsibility, not ours). Only fires the
  // transition edge into a positive signal, not on every render where the
  // signal happens to already be true.
  const prevSensorPositiveRef = useRef(false);
  useEffect(() => {
    const positive = sensorFrame.faceVisible === true || sensorFrame.motion === true;
    if (positive && !prevSensorPositiveRef.current && screenState.screen === 'idle') {
      onWake();
    }
    prevSensorPositiveRef.current = positive;
  }, [sensorFrame.faceVisible, sensorFrame.motion, screenState.screen, onWake]);

  // Owned here (not locally in WeatherDetail) so the preference survives
  // navigating away from and back to the Weather screen, and stays in sync
  // with HomeScreen's own temperature display -- AppShell is the
  // longest-lived owner across screen transitions, matching cameraEnabled's
  // pattern above.
  const [temperatureUnit, setTemperatureUnit] = useState<TemperatureUnit>('F');

  // Same in-memory-only, resets-on-restart pattern as temperatureUnit above --
  // this widget's color/brightness choice is a session preference, not a
  // persisted setting.
  const [lightColor, setLightColor] = useState<LightColorPreset>('white');
  const [lightBrightness, setLightBrightness] = useState(1);

  // Window-absolute rect of PresenceDetail's live-preview slot, reported via
  // measureInWindow on every layout. Passed through to the always-mounted
  // CameraPresence below so it can portal a real visible preview + face-box
  // overlay exactly onto that slot; null/undefined keeps CameraPresence's
  // existing invisible 1x1 fallback. Ignore zero-size rects: PresenceDetail's
  // first layout pass can transiently report {x:0,y:0,width:0,height:0}
  // before RN settles, and passing that through would briefly render a
  // zero-size <Camera>.
  const [previewRect, setPreviewRect] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null
  );
  const handlePreviewRect = (rect: { x: number; y: number; width: number; height: number } | null) => {
    if (rect && (rect.width <= 0 || rect.height <= 0)) return;
    setPreviewRect(rect);
  };

  // Clear the preview rect whenever the presence screen isn't showing, so
  // navigating away and back always starts from a clean null state instead
  // of holding a stale rect from before the last time this screen was left
  // (which would otherwise make CameraPresence portal a preview onto a slot
  // that no longer exists on screen).
  useEffect(() => {
    if (screenState.screen !== 'presence') {
      setPreviewRect(null);
    }
  }, [screenState.screen]);

  const stats = useMemo(() => readSystemStats(widgets), [widgets]);
  const weather = useMemo(() => readWeather(widgets), [widgets]);
  const presence = useMemo(() => derivePresence(sensorFrame, cameraEnabled), [sensorFrame, cameraEnabled]);

  // CPU/RAM sparkline history: accumulated here because AppShell is the
  // longest-lived owner of the widgets stream (mounted for the app's
  // lifetime), and both HomeScreen and SystemDetail need the same rolling
  // window rendered consistently regardless of which one is on screen.
  //
  // Gated in an effect keyed on `stats` (not pushed directly in the render
  // body) because AppShell re-renders once a second from the clock tick --
  // far more often than the ~2s cadence real widget updates arrive on. A
  // render-body push would re-push the same still-current value on every
  // clock tick between polls, padding the rolling window with duplicates
  // and flattening/distorting the sparkline's shape.
  const cpuHistoryRef = useRef<number[]>([]);
  const ramHistoryRef = useRef<number[]>([]);
  useEffect(() => {
    if (typeof stats.cpuPercent === 'number') {
      cpuHistoryRef.current = pushHistory(cpuHistoryRef.current, stats.cpuPercent, HISTORY_MAX_LEN);
    }
    if (typeof stats.ramPercent === 'number') {
      ramHistoryRef.current = pushHistory(ramHistoryRef.current, stats.ramPercent, HISTORY_MAX_LEN);
    }
  }, [stats]);

  // Derived from the `now` prop (not a fresh Date.now() call) so this value
  // only changes in step with the 1Hz tick AppShell's caller already drives
  // everything else with, and stays consistent/testable across renders.
  const awayMs = now - lastActivityRef.current;

  function renderScreen() {
    switch (screenState.screen) {
      case 'idle':
        return <IdleScreen now={now} awayMs={awayMs} onWake={onWake} />;
      case 'system':
        return <SystemDetail stats={stats} cpuHistory={cpuHistoryRef.current} ramHistory={ramHistoryRef.current} onBack={onBack} />;
      case 'weather':
        return (
          <WeatherDetail
            weather={weather}
            onBack={onBack}
            unit={temperatureUnit}
            onToggleUnit={() => setTemperatureUnit((u) => (u === 'F' ? 'C' : 'F'))}
          />
        );
      case 'playing':
        return (
          <NowPlayingDetail
            stats={stats}
            onBack={onBack}
            onTogglePlayPause={onTogglePlayPause}
            onNext={onNextTrack}
            onPrevious={onPreviousTrack}
          />
        );
      case 'presence':
        return (
          <PresenceDetail
            presence={presence}
            sensorFrame={sensorFrame}
            cameraEnabled={cameraEnabled}
            onToggleCamera={() => setCameraEnabled(!cameraEnabled)}
            automationEnabled={automationEnabled}
            onToggleAutomation={onToggleAutomation}
            onBack={onBack}
            onSleepNow={onSleep}
            onPreviewRect={handlePreviewRect}
          />
        );
      case 'light':
        return (
          <LightScreen
            color={lightColor}
            onToggleColor={() => setLightColor((c) => (c === 'white' ? 'sunlight' : 'white'))}
            brightness={lightBrightness}
            onChangeBrightness={setLightBrightness}
            onBack={onBack}
            bumpActivity={bumpActivity}
          />
        );
      case 'clock':
        return <ClockScreen now={now} startedAt={startedAt} onBack={onBack} />;
      case 'standby':
        return <StandbyScreen standby={screenState.standby ?? STANDBY_VOICE} onBack={onBack} />;
      case 'home':
      default:
        return (
          <HomeScreen
            stats={stats}
            weather={weather}
            presence={presence}
            now={now}
            startedAt={startedAt}
            cpuHistory={cpuHistoryRef.current}
            ramHistory={ramHistoryRef.current}
            unit={temperatureUnit}
            onGoSystem={onGoSystem}
            onGoWeather={onGoWeather}
            onGoPlaying={onGoPlaying}
            onGoPresence={onGoPresence}
            onGoClock={onGoClock}
            onGoVoice={onGoVoice}
            onGoDeck={onGoDeck}
            onGoLight={onGoLight}
          />
        );
    }
  }

  // Both the sleeping display and the immersive Chin Light run chrome-free and
  // edge-to-edge: idle is a near-black clock, light is a solid full-bleed fill
  // for a video call. Showing the header on the light screen ate the top of
  // the fill with a dark bar; hiding it (as idle already does) makes the light
  // truly full-bleed top-to-bottom.
  const chromeless = screenState.screen === 'idle' || immersiveLight;

  return (
    <Animated.View
      style={[styles.root, { transform: translate.getTranslateTransform() }]}
      onTouchStart={bumpActivity}
      onStartShouldSetResponder={() => {
        bumpActivity();
        return false;
      }}
    >
      {!chromeless && (
        <Header connectionState={connectionState} presence={presence} onSleep={onSleep} />
      )}
      <View style={styles.body}>{renderScreen()}</View>

      <CameraPresence
        enabled={cameraEnabled}
        send={sendFrame}
        connectionEpoch={connectionEpoch}
        onSensor={onSensor}
        previewRect={previewRect}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    // Clip the pixel-shift transform so a drifted frame can never leave a
    // ghost/afterimage of scrolled content bleeding past the viewport edges
    // (seen as faint bottom-row labels at the top of the home screen).
    overflow: 'hidden',
  },
  body: {
    flex: 1,
    overflow: 'hidden',
  },
});
