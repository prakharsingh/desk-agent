import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { theme } from './theme.js';
import type { ConnectionState } from '../wsClient.js';
import type { PresenceView } from './derivePresence.js';
import { connectionChip } from './connectionChip.js';

export interface HeaderProps {
  connectionState: ConnectionState;
  presence: PresenceView;
  onSleep: () => void;
  onGoSettings: () => void;
}

// Cosmetic build label only -- not read from package.json to avoid coupling
// this presentational component to a build-time JSON import; bump by hand
// alongside real release milestones.
const VERSION_LABEL = 'v0.2.0';

export function Header({ connectionState, presence, onSleep, onGoSettings }: HeaderProps) {
  const chip = connectionChip(connectionState);

  return (
    <View style={styles.row}>
      <View style={styles.wordmarkRow}>
        <Text style={styles.wordmark}>DESK</Text>
        <Text style={styles.accentDot}>·</Text>
        <Text style={styles.wordmark}>AGENT</Text>
        <Text style={styles.version}>{VERSION_LABEL}</Text>
      </View>

      <View style={styles.statusRow}>
        <View style={styles.chip}>
          <View style={[styles.dot, { backgroundColor: chip.color }]} />
          <Text style={[styles.chipLabel, { color: chip.color }, chip.dim && styles.chipLabelDim]}>{chip.label}</Text>
        </View>

        <View style={styles.chip}>
          <View style={[styles.dot, { backgroundColor: presence.color }]} />
          <Text style={[styles.chipLabel, { color: presence.color }]}>{presence.label}</Text>
        </View>

        <Pressable onPress={onGoSettings} hitSlop={8}>
          <Text style={styles.sleepGlyph}>⚙</Text>
        </Pressable>

        <Pressable onPress={onSleep} hitSlop={8}>
          <Text style={styles.sleepGlyph}>◑</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
  },
  wordmarkRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: theme.spacing.xs,
  },
  wordmark: {
    fontSize: 13,
    letterSpacing: 2,
    color: theme.colors.text,
    fontFamily: theme.font.semibold,
  },
  accentDot: {
    fontSize: 13,
    color: theme.colors.accent,
    fontFamily: theme.font.semibold,
  },
  version: {
    fontSize: 9,
    color: theme.colors.textFainter,
    fontFamily: theme.font.regular,
    marginLeft: theme.spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chipLabel: {
    fontSize: 9,
    letterSpacing: 1,
    fontFamily: theme.font.medium,
  },
  chipLabelDim: {
    opacity: 0.7,
  },
  sleepGlyph: {
    fontSize: 16,
    color: theme.colors.textDim,
  },
});
