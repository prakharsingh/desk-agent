import React from 'react';
import { View, Text } from 'react-native';
import type { Widget } from '@desk-agent/protocol';

export function SystemStatsWidget({ widget }: { widget: Widget }) {
  const { cpuPercent, ramPercent, battery, nowPlaying } = widget.props as {
    cpuPercent: number; ramPercent: number; battery: string; nowPlaying: string;
  };
  return (
    <View>
      <Text>CPU: {cpuPercent}%</Text>
      <Text>RAM: {ramPercent}%</Text>
      <Text>Battery: {battery}</Text>
      <Text>Now Playing: {nowPlaying}</Text>
    </View>
  );
}
