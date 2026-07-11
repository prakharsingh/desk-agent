import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Animated } from 'react-native';
import type { Frame, Widget } from '@desk-agent/protocol';
import { computePixelShiftOffset } from './oledMitigation.js';
import { CameraPrivacySwitch } from './CameraPrivacySwitch.js';
import { CameraPresence } from './presence/CameraPresence.js';
import { CameraIndicator } from './presence/CameraIndicator.js';
import { WsClient } from './wsClient.js';
import { resolveWidgetKind } from './widgets/renderWidget.js';
import { SystemStatsWidget } from './widgets/SystemStatsWidget.js';
import { WeatherWidget } from './widgets/WeatherWidget.js';
import { BrokenWidget } from './widgets/BrokenWidget.js';

const AMPLITUDE_PX = 2;
const PERIOD_MS = 60000;
const WS_URL = 'ws://localhost:8787';
const HEARTBEAT_TIMEOUT_MS = 15000;

export default function App() {
  const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const [startedAt] = useState(() => Date.now());
  const [widgets, setWidgets] = useState<Record<string, Widget>>({});
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [connectionEpoch, setConnectionEpoch] = useState(0);

  const client = useMemo(
    () =>
      new WsClient({
        url: WS_URL,
        heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
        onStateChange: (state) => {
          if (state === 'connected') setConnectionEpoch((n) => n + 1);
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

  useEffect(() => {
    const interval = setInterval(() => {
      const offset = computePixelShiftOffset(Date.now() - startedAt, AMPLITUDE_PX, PERIOD_MS);
      translate.setValue(offset);
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt, translate]);

  return (
    <Animated.View style={{ transform: translate.getTranslateTransform() }}>
      <View>
        {Object.entries(widgets).map(([widgetId, widget]: [string, Widget]) => {
          const kind = resolveWidgetKind(widget);
          if (kind === 'system-stats') return <SystemStatsWidget key={widgetId} widget={widget} />;
          if (kind === 'weather') return <WeatherWidget key={widgetId} widget={widget} />;
          return <BrokenWidget key={widgetId} widget={widget} />;
        })}
        <CameraIndicator cameraEnabled={cameraEnabled} />
        <CameraPrivacySwitch cameraEnabled={cameraEnabled} onCameraEnabledChange={setCameraEnabled} send={sendFrame} />
        <CameraPresence enabled={cameraEnabled} send={sendFrame} connectionEpoch={connectionEpoch} />
      </View>
    </Animated.View>
  );
}
