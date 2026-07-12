import React, { useRef } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { theme } from '../theme.js';
import type { SensorFrame } from '../sensorFrame.js';
import type { PresenceView } from '../derivePresence.js';
import { BackHeader } from '../ui/BackHeader.js';
import { Toggle } from '../ui/Toggle.js';

export interface PresenceDetailProps {
  presence: PresenceView;
  sensorFrame: SensorFrame;
  cameraEnabled: boolean;
  onToggleCamera: () => void;
  automationEnabled: boolean;
  onToggleAutomation?: () => void;
  onBack: () => void;
  onSleepNow: () => void;
  onPreviewRect?: (rect: { x: number; y: number; width: number; height: number } | null) => void;
}

function fmtTri(v: boolean | null): { text: string; color: string } {
  if (v === true) return { text: 'TRUE', color: theme.colors.accent };
  if (v === false) return { text: 'FALSE', color: theme.colors.textFaint };
  return { text: 'UNKNOWN', color: theme.colors.textFaint };
}

function fmtCameraState(v: SensorFrame['cameraState']): { text: string; color: string } {
  if (v === 'active') return { text: 'ACTIVE', color: theme.colors.accent };
  if (v === 'released') return { text: 'RELEASED', color: theme.colors.textFaint };
  if (v === 'error') return { text: 'ERROR', color: theme.colors.alert };
  return { text: 'UNKNOWN', color: theme.colors.textFaint };
}

export function PresenceDetail({
  presence,
  sensorFrame,
  cameraEnabled,
  onToggleCamera,
  automationEnabled,
  onToggleAutomation,
  onBack,
  onSleepNow,
  onPreviewRect,
}: PresenceDetailProps) {
  const face = fmtTri(sensorFrame.faceVisible);
  const gaze = fmtTri(sensorFrame.gaze);
  const motion = fmtTri(sensorFrame.motion);
  const camState = fmtCameraState(sensorFrame.cameraState);
  const previewRef = useRef<View>(null);

  const reportPreviewRect = () => {
    previewRef.current?.measureInWindow((x, y, width, height) => {
      onPreviewRect?.({ x, y, width, height });
    });
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <BackHeader title="PRESENCE" onBack={onBack} />

      <View style={styles.headline}>
        <View style={styles.headlineRow}>
          <View style={[styles.dot, { backgroundColor: presence.color }]} />
          <Text style={[styles.label, { color: presence.color }]}>{presence.label}</Text>
        </View>
        <Text style={styles.note}>{presence.note}</Text>
        <Text style={styles.localCaption}>local sensor view, not the Mac's fused presence engine</Text>
      </View>

      <View ref={previewRef} style={styles.previewCard} onLayout={reportPreviewRect}>
        {!cameraEnabled && (
          <View style={styles.previewPlaceholder}>
            <Text style={styles.previewGlyph}>○</Text>
            <Text style={styles.previewText}>LENS IDLE</Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>RAW SENSOR FRAME</Text>
        <View style={styles.frameRow}>
          <Text style={styles.frameKey}>face_visible</Text>
          <Text style={[styles.frameValue, { color: face.color }]}>{face.text}</Text>
        </View>
        <View style={styles.frameRow}>
          <Text style={styles.frameKey}>gaze_at_screen</Text>
          <Text style={[styles.frameValue, { color: gaze.color }]}>{gaze.text}</Text>
        </View>
        <View style={styles.frameRow}>
          <Text style={styles.frameKey}>motion</Text>
          <Text style={[styles.frameValue, { color: motion.color }]}>{motion.text}</Text>
        </View>
        <View style={styles.frameRow}>
          <Text style={styles.frameKey}>camera_state</Text>
          <Text style={[styles.frameValue, { color: camState.color }]}>{camState.text}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Camera presence</Text>
          <Toggle on={cameraEnabled} onToggle={onToggleCamera} />
        </View>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Automation</Text>
          <Toggle on={automationEnabled} onToggle={onToggleAutomation} />
        </View>
        <View style={styles.toggleRow}>
          <View>
            <Text style={styles.toggleLabel}>Monitor wake</Text>
            <Text style={styles.readOnlyCaption}>configured on Mac</Text>
          </View>
          {/* Read-only: no onToggle prop passed -- this setting is Mac-config-only. */}
          <Toggle on={false} />
        </View>
      </View>

      <View style={styles.privacyBanner}>
        <View
          style={[
            styles.privacyDot,
            { backgroundColor: cameraEnabled ? theme.colors.alert : theme.colors.textFainter },
          ]}
        />
        <Text style={[styles.privacyLabel, { color: cameraEnabled ? theme.colors.alert : theme.colors.textFaint }]}>
          {cameraEnabled ? 'CAMERA ACTIVE · FRAMES NEVER LEAVE DEVICE' : 'CAMERA RELEASED · LENS IDLE'}
        </Text>
      </View>

      <Pressable style={styles.sleepButton} onPress={onSleepNow}>
        <Text style={styles.sleepButtonText}>⏻ SLEEP DISPLAY NOW</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  content: {
    padding: theme.spacing.lg,
    gap: theme.spacing.xl,
  },
  headline: {
    gap: theme.spacing.xs,
  },
  previewCard: {
    height: 140,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.card,
    backgroundColor: theme.colors.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewPlaceholder: {
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  previewGlyph: {
    fontSize: 20,
    color: theme.colors.textFainter,
  },
  previewText: {
    fontSize: 11,
    letterSpacing: 2,
    color: theme.colors.textFaint,
    fontFamily: theme.font.regular,
  },
  headlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  label: {
    fontSize: 24,
    fontFamily: theme.font.semibold,
  },
  note: {
    fontSize: 12,
    color: theme.colors.textDim,
    fontFamily: theme.font.regular,
  },
  localCaption: {
    fontSize: 10,
    color: theme.colors.textFaint,
    fontFamily: theme.font.regular,
    fontStyle: 'italic',
  },
  section: {
    gap: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: 11,
    letterSpacing: 2,
    color: theme.colors.textFaint,
    fontFamily: theme.font.regular,
    marginBottom: theme.spacing.xs,
  },
  frameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  frameKey: {
    fontSize: 12,
    color: theme.colors.textFaint,
    fontFamily: theme.font.regular,
  },
  frameValue: {
    fontSize: 12,
    fontFamily: theme.font.medium,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
  },
  toggleLabel: {
    fontSize: 13,
    color: theme.colors.text,
    fontFamily: theme.font.regular,
  },
  readOnlyCaption: {
    fontSize: 10,
    color: theme.colors.textFainter,
    fontFamily: theme.font.regular,
  },
  privacyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.card,
    backgroundColor: theme.colors.bgAlt,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
  },
  privacyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  privacyLabel: {
    fontSize: 9,
    letterSpacing: 1,
    fontFamily: theme.font.medium,
  },
  sleepButton: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.card,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  sleepButtonText: {
    fontSize: 12,
    letterSpacing: 1,
    color: theme.colors.textDim,
    fontFamily: theme.font.medium,
  },
});
