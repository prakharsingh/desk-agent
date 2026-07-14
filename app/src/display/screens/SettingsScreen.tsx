import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { ScreensaverConfig } from '@desk-agent/protocol';
import { theme } from '../theme.js';
import { BackHeader } from '../ui/BackHeader.js';
import { Toggle } from '../ui/Toggle.js';

const PRESETS: { label: string; graceMs: number }[] = [
  { label: '1 MIN', graceMs: 60000 },
  { label: '2 MIN', graceMs: 120000 },
  { label: '5 MIN', graceMs: 300000 },
  { label: '10 MIN', graceMs: 600000 },
  { label: '30 MIN', graceMs: 1800000 },
];

export interface SettingsScreenProps {
  config: ScreensaverConfig;
  onChange: (config: ScreensaverConfig) => void;
  onBack: () => void;
}

export function SettingsScreen({ config, onChange, onBack }: SettingsScreenProps) {
  const toggleEnabled = () => onChange({ ...config, enabled: !config.enabled });

  return (
    <View style={styles.screen}>
      <BackHeader title="SETTINGS" onBack={onBack} />

      <Pressable onPress={toggleEnabled} style={styles.row}>
        <Text style={styles.rowLabel}>SCREENSAVER</Text>
        <View style={styles.rowRight}>
          <Text style={styles.rowValue}>{config.enabled ? 'ON' : 'OFF'}</Text>
          <Toggle on={config.enabled} onToggle={toggleEnabled} />
        </View>
      </Pressable>

      <Text style={styles.rowLabel}>IDLE TIMEOUT</Text>
      <View style={styles.presetRow}>
        {PRESETS.map((preset) => {
          const active = config.graceMs === preset.graceMs;
          return (
            <Pressable
              key={preset.label}
              onPress={() => onChange({ ...config, graceMs: preset.graceMs })}
              accessibilityState={{ selected: active }}
              style={[styles.presetButton, active && styles.presetButtonActive]}
            >
              <Text style={[styles.presetLabel, active && styles.presetLabelActive]}>{preset.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    padding: theme.spacing.lg,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
  },
  rowLabel: {
    fontSize: 12,
    letterSpacing: 1,
    color: theme.colors.textFaint,
    fontFamily: theme.font.regular,
    marginBottom: theme.spacing.sm,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  rowValue: {
    fontSize: 13,
    color: theme.colors.text,
    fontFamily: theme.font.regular,
  },
  presetRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    flexWrap: 'wrap',
  },
  presetButton: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  presetButtonActive: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  presetLabel: {
    fontSize: 12,
    color: theme.colors.textDim,
    fontFamily: theme.font.regular,
  },
  presetLabelActive: {
    color: theme.colors.bg,
    fontFamily: theme.font.semibold,
  },
});
