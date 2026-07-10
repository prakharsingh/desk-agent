import React from 'react';
import { View, Text } from 'react-native';
import type { Widget } from '@desk-agent/protocol';

export function WeatherWidget({ widget }: { widget: Widget }) {
  const { tempF, conditions, stale } = widget.props as { tempF: number; conditions: string; stale: boolean };
  return (
    <View>
      <Text>{tempF}°F, {conditions}{stale ? ' (stale)' : ''}</Text>
    </View>
  );
}
