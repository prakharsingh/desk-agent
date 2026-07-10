import React from 'react';
import { View, Text } from 'react-native';
import type { Widget } from '@desk-agent/protocol';

export function BrokenWidget({ widget }: { widget: Widget }) {
  return (
    <View>
      <Text>Widget unavailable ({widget.type})</Text>
    </View>
  );
}
