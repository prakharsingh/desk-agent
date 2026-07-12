import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Frame, Widget } from '@desk-agent/protocol';
import { WsClient, type ConnectionState } from './wsClient.js';
import { AppShell } from './display/AppShell.js';
import { INITIAL_SCREEN_STATE, STANDBY_DECK, STANDBY_VOICE, back, goTo, goToStandby, sleep, wake } from './display/screens.js';
import { UNKNOWN_SENSOR_FRAME, mergeSensorFrame, resetSensorFrame, type SensorFrame } from './display/sensorFrame.js';
import { buildMediaActionFrame, buildOverrideFrame } from './presenceEvents.js';

const WS_URL = 'ws://localhost:8787';
const HEARTBEAT_TIMEOUT_MS = 15000;

export default function App() {
  const [startedAt] = useState(() => Date.now());
  const [widgets, setWidgets] = useState<Record<string, Widget>>({});
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [automationEnabled, setAutomationEnabled] = useState(true);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [sensorFrame, setSensorFrame] = useState<SensorFrame>(UNKNOWN_SENSOR_FRAME);
  const [screenState, setScreenState] = useState(INITIAL_SCREEN_STATE);
  const [now, setNow] = useState(() => Date.now());

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
          if (frame.type !== 'widget.update') return;
          setWidgets((prev: Record<string, Widget>) => {
            const next = { ...prev };
            for (const entry of frame.payload.widgets) next[entry.widgetId] = entry.widget;
            return next;
          });
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
      onBack={onBack}
      onSleep={onSleep}
      onWake={onWake}
    />
  );
}
