import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Animated } from 'react-native';
import type { Frame, Widget } from '@desk-agent/protocol';
import { computePixelShiftOffset } from './oledMitigation.js';
import { PresenceToggle } from './PresenceToggle.js';
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

  const client = useMemo(
    () =>
      new WsClient({
        url: WS_URL,
        heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
        onStateChange: () => {},
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
        <PresenceToggle send={(json) => client.send(json)} />
      </View>
    </Animated.View>
  );
}
