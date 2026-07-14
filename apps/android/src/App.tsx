import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { parseScreensaverConfig, type Frame, type ScreensaverConfig, type Widget } from '@desk-agent/protocol';
import { WsClient, type ConnectionState } from './wsClient.js';
import { AppShell } from './display/AppShell.js';
import { INITIAL_SCREEN_STATE, STANDBY_DECK, STANDBY_VOICE, back, goTo, goToStandby, sleep, wake } from './display/screens.js';
import { UNKNOWN_SENSOR_FRAME, mergeSensorFrame, resetSensorFrame, type SensorFrame } from './display/sensorFrame.js';
import { DEFAULT_SCREENSAVER_CONFIG, loadScreensaverConfig, saveScreensaverConfig } from './display/screensaverConfig.js';
import { buildMediaActionFrame, buildOverrideFrame, buildScreensaverConfigFrame } from './presenceEvents.js';

const WS_URL = 'ws://localhost:8787';
const HEARTBEAT_TIMEOUT_MS = 15000;

export default function App() {
  const [startedAt] = useState(() => Date.now());
  const [widgets, setWidgets] = useState<Record<string, Widget>>({});
  // undefined until the first hello-reply arrives -- HomeScreen treats that
  // as "show everything" (fail open), not "hide everything".
  const [visibleWidgets, setVisibleWidgets] = useState<readonly string[] | undefined>(undefined);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [automationEnabled, setAutomationEnabled] = useState(true);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [sensorFrame, setSensorFrame] = useState<SensorFrame>(UNKNOWN_SENSOR_FRAME);
  const [screenState, setScreenState] = useState(INITIAL_SCREEN_STATE);
  const [now, setNow] = useState(() => Date.now());
  // null until the AsyncStorage load below resolves; AppShell/SettingsScreen
  // always receive DEFAULT_SCREENSAVER_CONFIG as a fallback in the meantime
  // (see the JSX below), matching today's pre-feature hardcoded behavior.
  const [screensaverConfig, setScreensaverConfig] = useState<ScreensaverConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadScreensaverConfig().then((config) => {
      if (!cancelled) setScreensaverConfig(config);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const client = useMemo(
    () =>
      new WsClient({
        url: WS_URL,
        heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
        onStateChange: (state) => {
          if (state === 'connected') setConnectionEpoch((n) => n + 1);
          setConnectionState(state);
        },
        onFrame: (frame: Frame) => {
          if (frame.type === 'action.invoke' && frame.payload.pluginId === 'phone-display' && frame.payload.action === 'setScreensaverConfig') {
            const result = parseScreensaverConfig(frame.payload.args);
            if (result.ok) {
              setScreensaverConfig(result.value);
              void saveScreensaverConfig(result.value);
            }
            return;
          }
          if (frame.type !== 'widget.update') return;
          setWidgets((prev: Record<string, Widget>) => {
            const next = { ...prev };
            for (const entry of frame.payload.widgets) next[entry.widgetId] = entry.widget;
            return next;
          });
          // Only the hello-reply snapshot carries this (see
          // WidgetUpdatePayloadSchema's comment) -- a later single-widget
          // push omits it and must not be treated as "hide everything".
          if (frame.payload.visibleWidgets) setVisibleWidgets(frame.payload.visibleWidgets);
        },
      }),
    [],
  );

  useEffect(() => {
    client.connect();
    return () => client.disconnect();
  }, [client]);

  // Stable identity across renders: `CameraPresence`'s lifecycle effect
  // lists `send` in its dependency array so it can re-announce camera_state
  // on a real reconnect (`connectionEpoch` change). An unmemoized inline
  // arrow here would get a fresh identity on every App re-render (e.g. every
  // widget.update), re-running that effect and re-announcing camera_state on
  // every unrelated render instead of only on genuine lifecycle/reconnect
  // transitions.
  const sendFrame = useCallback((json: string) => client.send(json), [client]);

  // Publishes the phone's current screensaver config to the Mac whenever it
  // changes for ANY reason (local edit via SettingsScreen, or a remote
  // change just applied above) AND on every fresh reconnect (connectionEpoch)
  // -- both requirements from the design doc collapse into one effect. If
  // this fires before the socket is actually open, WsClient.send() silently
  // drops it (see wsClient.ts's doc comment) and the NEXT connectionEpoch
  // change re-fires this effect and sends successfully -- no message that
  // matters here is ever truly lost.
  useEffect(() => {
    if (screensaverConfig) sendFrame(JSON.stringify(buildScreensaverConfigFrame(screensaverConfig)));
  }, [screensaverConfig, connectionEpoch, sendFrame]);

  const onChangeScreensaverConfig = useCallback((config: ScreensaverConfig) => {
    setScreensaverConfig(config);
    void saveScreensaverConfig(config);
  }, []);

  const onGoSettings = useCallback(() => setScreenState((s) => goTo(s, 'settings')), []);

  // Real automation-override state, moved up from CameraPrivacySwitch (Slice
  // 1d on-device fix): flips local state and sends the same
  // automation.override wire frame that switch used to send, but now
  // reachable via PresenceDetail's Automation toggle instead of a raw,
  // unstyled floating switch.
  const onToggleAutomation = useCallback(() => {
    setAutomationEnabled((prev) => {
      const next = !prev;
      sendFrame(JSON.stringify(buildOverrideFrame(next)));
      return next;
    });
  }, [sendFrame]);

  // Same stability requirement as `sendFrame` above, but for the sensor
  // callback threaded down to `CameraPresence` via `AppShell`: that
  // component's lifecycle effect also lists `onSensor` in its dependency
  // array (Task 10's forward note). An unmemoized inline arrow here would
  // re-run that effect -- and re-announce camera_state/sensor edges -- on
  // every unrelated App re-render instead of only on genuine
  // lifecycle/reconnect transitions.
  const onSensor = useCallback(
    (partial: Partial<SensorFrame>) => setSensorFrame((prev) => mergeSensorFrame(prev, partial)),
    [],
  );

  // Media controls send an action.invoke to the system-stats plugin, which
  // forwards it to nowplaying-cli -- these have no local state to flip (the
  // real playing/paused/track state comes back on the next widget.update),
  // so each is just a stable sendFrame wrapper, same stability reasoning as
  // onToggleAutomation above.
  const onTogglePlayPause = useCallback(() => {
    sendFrame(JSON.stringify(buildMediaActionFrame('togglePlayPause')));
  }, [sendFrame]);
  const onNextTrack = useCallback(() => {
    sendFrame(JSON.stringify(buildMediaActionFrame('next')));
  }, [sendFrame]);
  const onPreviousTrack = useCallback(() => {
    sendFrame(JSON.stringify(buildMediaActionFrame('previous')));
  }, [sendFrame]);

  const setCameraEnabledAndReset = useCallback((enabled: boolean) => {
    setCameraEnabled(enabled);
    if (!enabled) setSensorFrame(resetSensorFrame());
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const onGoSystem = useCallback(() => setScreenState((s) => goTo(s, 'system')), []);
  const onGoWeather = useCallback(() => setScreenState((s) => goTo(s, 'weather')), []);
  const onGoPlaying = useCallback(() => setScreenState((s) => goTo(s, 'playing')), []);
  const onGoPresence = useCallback(() => setScreenState((s) => goTo(s, 'presence')), []);
  const onGoClock = useCallback(() => setScreenState((s) => goTo(s, 'clock')), []);
  const onGoVoice = useCallback(() => setScreenState((s) => goToStandby(s, STANDBY_VOICE)), []);
  const onGoDeck = useCallback(() => setScreenState((s) => goToStandby(s, STANDBY_DECK)), []);
  const onGoLight = useCallback(() => setScreenState((s) => goTo(s, 'light')), []);
  const onBack = useCallback(() => setScreenState(back), []);
  const onSleep = useCallback(() => setScreenState(sleep), []);
  const onWake = useCallback(() => setScreenState(wake), []);

  return (
    <AppShell
      widgets={widgets}
      visibleWidgets={visibleWidgets}
      connectionState={connectionState}
      sensorFrame={sensorFrame}
      cameraEnabled={cameraEnabled}
      setCameraEnabled={setCameraEnabledAndReset}
      automationEnabled={automationEnabled}
      onToggleAutomation={onToggleAutomation}
      onTogglePlayPause={onTogglePlayPause}
      onNextTrack={onNextTrack}
      onPreviousTrack={onPreviousTrack}
      sendFrame={sendFrame}
      connectionEpoch={connectionEpoch}
      onSensor={onSensor}
      startedAt={startedAt}
      now={now}
      screenState={screenState}
      onGoSystem={onGoSystem}
      onGoWeather={onGoWeather}
      onGoPlaying={onGoPlaying}
      onGoPresence={onGoPresence}
      onGoClock={onGoClock}
      onGoVoice={onGoVoice}
      onGoDeck={onGoDeck}
      onGoLight={onGoLight}
      onGoSettings={onGoSettings}
      onBack={onBack}
      onSleep={onSleep}
      onWake={onWake}
      screensaverConfig={screensaverConfig ?? DEFAULT_SCREENSAVER_CONFIG}
      onChangeScreensaverConfig={onChangeScreensaverConfig}
    />
  );
}
