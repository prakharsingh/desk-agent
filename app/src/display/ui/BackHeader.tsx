import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { theme } from '../theme.js';

export function BackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.row}>
      <Pressable onPress={onBack}>
        <Text style={styles.back}>‹ BACK</Text>
      </Pressable>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  back: {
    fontSize: 12,
    color: theme.colors.accent,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 3,
    color: theme.colors.text,
  },
});
