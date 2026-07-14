import React from 'react';
import { Pressable, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { theme } from '../theme.js';

export function Card({
  onPress,
  children,
  style,
  accent,
  variant = 'default',
}: {
  onPress?: () => void;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  // Left-edge accent bar: `true` uses the theme accent color, or pass an
  // explicit color. Omitted (the default) renders no bar -- existing callers
  // are visually unchanged.
  accent?: boolean | string;
  // 'roadmap' is the dashed, dimmed treatment for not-yet-connected modules
  // (Voice, Steam Deck) -- it also suppresses the accent bar regardless of
  // the `accent` prop, since a roadmap card is deliberately de-emphasized.
  variant?: 'default' | 'roadmap';
}) {
  const isRoadmap = variant === 'roadmap';
  const accentColor = !isRoadmap && accent ? (accent === true ? theme.colors.accent : accent) : null;

  const content = (
    <>
      {accentColor ? <View style={[styles.accentBar, { backgroundColor: accentColor }]} /> : null}
      {children}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, isRoadmap && styles.cardRoadmap, pressed && styles.cardPressed, style]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={[styles.card, isRoadmap && styles.cardRoadmap, style]}>{content}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.card,
    backgroundColor: theme.colors.bgAlt,
    padding: theme.spacing.lg,
  },
  cardPressed: {
    borderColor: '#2d4038',
  },
  cardRoadmap: {
    borderStyle: 'dashed',
    borderColor: theme.colors.roadmapBorder,
    backgroundColor: theme.colors.roadmapBg,
    opacity: 0.72,
  },
  accentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 0,
    opacity: 0.55,
  },
});
