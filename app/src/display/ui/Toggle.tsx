import React from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { theme } from '../theme.js';

export function Toggle({ on, onToggle }: { on: boolean; onToggle?: () => void }) {
  const track = [
    styles.track,
    {
      backgroundColor: on ? 'rgba(95,208,122,0.22)' : theme.colors.borderDim,
      borderColor: on ? '#3f7a52' : theme.colors.border,
    },
  ];
  const knob = [
    styles.knob,
    {
      left: on ? 24 : 2,
      backgroundColor: on ? theme.colors.accent : theme.colors.textFainter,
    },
    on && styles.knobGlow,
  ];

  if (!onToggle) {
    return (
      <View style={track}>
        <View style={knob} />
      </View>
    );
  }

  return (
    <Pressable onPress={onToggle} style={track}>
      <View style={knob} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 46,
    height: 24,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
  },
  knob: {
    position: 'absolute',
    top: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  knobGlow: {
    shadowColor: theme.colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
  },
});
