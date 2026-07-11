import React, { useState } from 'react';
import { View, Text, Switch } from 'react-native';
import { buildOverrideFrame } from './presenceEvents.js';

export function CameraPrivacySwitch({
  cameraEnabled,
  onCameraEnabledChange,
  send,
}: {
  cameraEnabled: boolean;
  onCameraEnabledChange: (enabled: boolean) => void;
  send: (json: string) => void;
}) {
  const [overrideEnabled, setOverrideEnabled] = useState(true);

  return (
    <View>
      <Text>Camera Presence Detection</Text>
      <Switch value={cameraEnabled} onValueChange={onCameraEnabledChange} />
      <Text>Automation Enabled (manual override)</Text>
      <Switch value={overrideEnabled} onValueChange={(value) => { setOverrideEnabled(value); send(JSON.stringify(buildOverrideFrame(value))); }} />
    </View>
  );
}
