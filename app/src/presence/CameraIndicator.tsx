import React from 'react';
import { View, Text } from 'react-native';

export function CameraIndicator({ cameraEnabled }: { cameraEnabled: boolean }) {
  if (!cameraEnabled) return null;
  return (
    <View style={{ backgroundColor: 'red', padding: 4 }}>
      <Text style={{ color: 'white' }}>● Camera active</Text>
    </View>
  );
}
