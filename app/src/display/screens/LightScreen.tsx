import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, NativeModules, type GestureResponderEvent, type LayoutChangeEvent, PanResponder } from 'react-native';
import { theme } from '../theme.js';
import { renderedLightColor, type LightColorPreset } from '../lightColor.js';
import { Toggle } from '../ui/Toggle.js';

// Task 3's in-repo native module (app/android/.../BrightnessModule.kt), accessed
// via NativeModules the same way CameraPresence.tsx accesses
// NativeModules.PresenceService. Typed locally since NativeModules itself isn't
// typed per-module.
interface BrightnessNativeModule {
  getBrightnessLevel(): Promise<number>;
  setBrightnessLevel(level: number): void;
}
const Brightness = NativeModules.Brightness as BrightnessNativeModule | undefined;

export interface LightScreenProps {
  color: LightColorPreset;
  onToggleColor: () => void;
  brightness: number;
  onChangeBrightness: (value: number) => void;
  onBack: () => void;
  // Called periodically while this screen is mounted so AppShell's local
  // auto-idle timer never fires during a video call, even if the user never
  // touches the screen -- see AppShell.tsx's GRACE_MS comment.
  bumpActivity: () => void;
}

// Generous ceiling so a normal video call is never interrupted, while still
// eventually protecting the OLED panel if the phone is left showing a
// full-brightness solid color unattended for an unusually long time.
const AUTO_EXIT_MS = 30 * 60 * 1000;
const BUMP_ACTIVITY_INTERVAL_MS = 30000;
// Fallback only, used for the single frame before onLayout reports the
// track's real measured width -- the control strip's row width varies by
// device, so the slider's actual drag range and knob position are always
// driven by sliderWidthRef (see onLayout below), never this constant.
const FALLBACK_SLIDER_WIDTH = 200;

export function LightScreen({ color, onToggleColor, brightness, onChangeBrightness, onBack, bumpActivity }: LightScreenProps) {
  const [controlsVisible, setControlsVisible] = useState(false);
  const priorBrightnessRef = useRef<number | null>(null);

  // Force OS brightness to max on mount, restore the phone's own prior
  // brightness on unmount (navigating away via the close button, or the
  // 30-minute auto-exit below).
  useEffect(() => {
    let unmounted = false;
    Brightness?.getBrightnessLevel()
      ?.then((level) => {
        priorBrightnessRef.current = level;
        if (unmounted) {
          Brightness?.setBrightnessLevel(level);
        }
      })
      ?.catch((err) => {
        // No current activity (or another native-side failure) to read prior
        // brightness from -- leaves brightness forced at max until this
        // screen's window loses focus (the native module's own auto-revert).
        // Logged rather than silently swallowed so a persistent failure is
        // at least visible in on-device logs.
        console.warn('[LightScreen] getBrightnessLevel failed, prior brightness unknown:', err);
      });
    Brightness?.setBrightnessLevel(1);
    return () => {
      unmounted = true;
      if (priorBrightnessRef.current !== null) {
        Brightness?.setBrightnessLevel(priorBrightnessRef.current);
      }
    };
  }, []);

  // Idle-suppression: bump AppShell's activity clock on an interval well
  // inside its 2-minute GRACE_MS, so the display never auto-idles mid-call
  // even with zero screen touches.
  useEffect(() => {
    bumpActivity();
    const interval = setInterval(bumpActivity, BUMP_ACTIVITY_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [bumpActivity]);

  // 30-minute auto-exit ceiling, independent of AppShell's own (suppressed)
  // idle timer -- this one is this screen's own safety net. mountedAtRef is
  // initialized once on first render (useRef initializers only ever run
  // once), so it can't be reset by onBack changing identity across renders
  // -- unlike a plain `const mountedAt = Date.now()` captured inside the
  // effect body, which WOULD reset every time this effect re-runs due to
  // [onBack] changing. autoExitFiredRef guards against firing onBack more
  // than once after the threshold is crossed.
  const mountedAtRef = useRef(Date.now());
  const autoExitFiredRef = useRef(false);
  useEffect(() => {
    const interval = setInterval(() => {
      if (!autoExitFiredRef.current && Date.now() - mountedAtRef.current >= AUTO_EXIT_MS) {
        autoExitFiredRef.current = true;
        onBack();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [onBack]);

  // panResponder is constructed once (see useRef(...).current below), so its
  // callbacks close over whatever values were in scope at that one
  // construction. latestBrightnessRef is kept fresh via this effect so that
  // onPanResponderGrant always reads the CURRENT brightness at the moment a
  // new drag starts, rather than a stale value from initial mount.
  const latestBrightnessRef = useRef(brightness);
  useEffect(() => {
    latestBrightnessRef.current = brightness;
  }, [brightness]);

  const dragStartBrightnessRef = useRef(brightness);

  // The track's rendered width depends on the device's screen width (the
  // control strip's row also holds the color toggle and close button), so
  // it's measured via onLayout rather than assumed -- see FALLBACK_SLIDER_WIDTH
  // above for why a constant here previously made the slider's drag range and
  // the actual visible/touchable track diverge on narrower screens.
  const [sliderWidth, setSliderWidth] = useState(FALLBACK_SLIDER_WIDTH);
  const sliderWidthRef = useRef(sliderWidth);
  useEffect(() => {
    sliderWidthRef.current = sliderWidth;
  }, [sliderWidth]);

  const handleSliderLayout = (event: LayoutChangeEvent) => {
    setSliderWidth(event.nativeEvent.layout.width);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragStartBrightnessRef.current = latestBrightnessRef.current;
      },
      onPanResponderMove: (_evt: GestureResponderEvent, gestureState) => {
        const next = Math.max(0, Math.min(1, dragStartBrightnessRef.current + gestureState.dx / sliderWidthRef.current));
        onChangeBrightness(next);
      },
    })
  ).current;

  const backgroundColor = renderedLightColor(color, brightness);

  return (
    <Pressable style={[styles.screen, { backgroundColor }]} onPress={() => setControlsVisible((v) => !v)}>
      {controlsVisible && (
        <View style={styles.controlStrip} onStartShouldSetResponder={() => true}>
          <View style={styles.colorToggleRow}>
            <Text style={[styles.colorLabel, color === 'white' && styles.colorLabelActive]}>WHITE</Text>
            <Toggle on={color === 'sunlight'} onToggle={onToggleColor} />
            <Text style={[styles.colorLabel, color === 'sunlight' && styles.colorLabelActive]}>SUNLIGHT</Text>
          </View>
          <View style={styles.sliderTrack} onLayout={handleSliderLayout} {...panResponder.panHandlers}>
            <View style={[styles.sliderFill, { width: `${brightness * 100}%` }]} />
            <View style={[styles.sliderKnob, { left: brightness * sliderWidth - 8 }]} />
          </View>
          <Pressable onPress={onBack} style={styles.closeButton} hitSlop={12}>
            <Text style={styles.closeButtonText}>×</Text>
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  controlStrip: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(5,7,8,0.85)',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.lg,
  },
  colorToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  colorLabel: {
    fontSize: 11,
    letterSpacing: 1,
    color: theme.colors.textFainter,
    fontFamily: theme.font.medium,
  },
  colorLabelActive: {
    color: theme.colors.text,
  },
  sliderTrack: {
    flex: 1,
    height: 24,
    justifyContent: 'center',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.accent,
  },
  sliderKnob: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.accent,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 22,
    color: theme.colors.text,
    fontFamily: theme.font.regular,
  },
});
