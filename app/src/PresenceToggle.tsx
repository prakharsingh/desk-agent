import React, { useState } from 'react';
import { View, Text, Switch } from 'react-native';
import { buildPresenceFrame, buildOverrideFrame } from './presenceEvents.js';

export function PresenceToggle({ send }: { send: (json: string) => void }) {
  const [present, setPresent] = useState(true);
  const [overrideEnabled, setOverrideEnabled] = useState(true);

  return (
    <View>
      <Text>Present</Text>
      <Switch value={present} onValueChange={(value) => { setPresent(value); send(JSON.stringify(buildPresenceFrame(value))); }} />
      <Text>Automation Enabled (manual override)</Text>
      <Switch value={overrideEnabled} onValueChange={(value) => { setOverrideEnabled(value); send(JSON.stringify(buildOverrideFrame(value))); }} />
    </View>
  );
}
