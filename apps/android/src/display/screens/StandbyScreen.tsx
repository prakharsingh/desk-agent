import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme.js';
import type { StandbyInfo } from '../screens.js';
import { BackHeader } from '../ui/BackHeader.js';
import { Badge } from '../ui/Badge.js';

export interface StandbyScreenProps {
  standby: StandbyInfo;
  onBack: () => void;
}

export function StandbyScreen({ standby, onBack }: StandbyScreenProps) {
  return (
    <View style={styles.screen}>
      <BackHeader title={standby.name} onBack={onBack} />
      <View style={styles.body}>
        <Text style={styles.glyph}>{standby.glyph}</Text>
        <Text style={styles.caption}>MODULE NOT CONNECTED</Text>
        <Text style={styles.desc}>{standby.desc}</Text>
        <Badge label="ON THE ROADMAP" tone="neutral" style={styles.badge} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    padding: theme.spacing.lg,
    gap: theme.spacing.xl,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
  },
  glyph: {
    fontSize: 64,
    color: theme.colors.textFaint,
  },
  caption: {
    fontSize: 12,
    letterSpacing: 2,
    color: theme.colors.textFaint,
    fontFamily: theme.font.regular,
  },
  desc: {
    fontSize: 13,
    lineHeight: 20,
    color: theme.colors.textDim,
    fontFamily: theme.font.regular,
    textAlign: 'center',
  },
  badge: {
    marginTop: theme.spacing.md,
  },
});
