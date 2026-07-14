import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme.js';
import { ProgressBar } from './ProgressBar.js';

export function StatBar({
  label,
  value,
  pct,
  color,
}: {
  label: string;
  value: string;
  pct: number;
  color: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{value}</Text>
      </View>
      <ProgressBar pct={pct} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: theme.spacing.xs,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 11,
    color: theme.colors.textFaint,
    fontFamily: theme.font.regular,
  },
  value: {
    fontSize: 11,
    color: theme.colors.textDim,
    fontFamily: theme.font.regular,
  },
});
