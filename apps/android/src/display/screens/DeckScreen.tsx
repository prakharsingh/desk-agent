import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, Vibration, View, StyleSheet } from 'react-native';
import { theme } from '../theme.js';
import { BackHeader } from '../ui/BackHeader.js';
import { computeDeckGrid } from '../deckLayout.js';
import { pressStateFor, DECK_ACK_TIMEOUT_MS, type InFlightPress, type DeckAck } from '../deckPress.js';
import type { DeckButtonView } from '../widgetReaders.js';

const OK_BLIP_MS = 600;
const GAP = 10;

export function DeckScreen({
  buttons,
  grid,
  lastPress,
  onPressButton, // parent (App.tsx) sends the right frame and returns the seq used
  onBack,
}: {
  buttons: DeckButtonView[];
  grid?: { rows: number; cols: number };
  lastPress?: DeckAck;
  onPressButton: (button: DeckButtonView) => number | null; // null => builtin (fire-and-forget, no seq tracking)
  onBack: () => void;
}) {
  const { width } = useWindowDimensions();
  const layout = computeDeckGrid(width - 32, buttons.length, grid);
  const [pressed, setPressed] = useState<InFlightPress | null>(null);
  const [, forceTick] = useState(0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPressRef = useRef<DeckAck | undefined>(lastPress);
  useEffect(() => { lastPressRef.current = lastPress; }, [lastPress]);

  // Re-render once at the ack deadline so a never-acked press flips to the
  // error treatment, then -- if it's still un-acked at that point -- decay it
  // back to idle shortly after (OK_BLIP_MS) instead of leaving it wedged.
  useEffect(() => {
    if (!pressed) return;
    if (clearTimer.current) clearTimeout(clearTimer.current);
    const timeoutSeq = pressed.seq;
    clearTimer.current = setTimeout(() => {
      forceTick((n) => n + 1);
      clearTimer.current = setTimeout(() => {
        const ack = lastPressRef.current;
        const stillUnacked = !ack || ack.seq !== timeoutSeq || ack.state === 'pending';
        if (stillUnacked) {
          setPressed((current) => (current && current.seq === timeoutSeq ? null : current));
        }
      }, OK_BLIP_MS);
    }, DECK_ACK_TIMEOUT_MS + 50);
    return () => { if (clearTimer.current) clearTimeout(clearTimer.current); };
  }, [pressed]);

  useEffect(() => {
    if (!pressed || !lastPress || lastPress.seq !== pressed.seq || lastPress.state === 'pending') return;
    // Phone-clock latency segment #2 (spec hard requirement): press -> ack
    // round trip, single clock, no cross-device comparison.
    if (__DEV__) console.log(`[deck] ack round-trip seq=${pressed.seq} ${Date.now() - pressed.sentAt}ms state=${lastPress.state}`);
    const decay = setTimeout(() => setPressed(null), OK_BLIP_MS);
    return () => clearTimeout(decay);
  }, [lastPress, pressed]);

  const handlePressIn = useCallback((button: DeckButtonView) => {
    Vibration.vibrate(10);
    const seq = onPressButton(button);
    if (seq !== null) setPressed({ seq, buttonId: button.id, sentAt: Date.now() });
  }, [onPressButton]);

  const cellSize = Math.floor((width - 32 - GAP * (layout.cols - 1)) / layout.cols);

  return (
    <View style={styles.root}>
      <BackHeader title="DECK" onBack={onBack} />
      {buttons.length === 0 ? (
        <Text style={styles.empty}>NO BUTTONS CONFIGURED — ADD deck.buttons IN config.json</Text>
      ) : (
        <ScrollView contentContainerStyle={[styles.grid, { gap: GAP }]}>
          {buttons.map((button) => {
            const state = pressStateFor(button.id, pressed, lastPress, Date.now());
            const accent = button.color ?? theme.colors.accent;
            return (
              <Pressable
                key={button.id}
                onPressIn={() => handlePressIn(button)}
                style={({ pressed: touchPressed }) => [
                  styles.btn,
                  { width: cellSize, height: cellSize },
                  state === 'pending' && styles.btnPending,
                  state === 'ok' && styles.btnOk,
                  state === 'error' && styles.btnError,
                  // Builtin buttons return null from onPressButton, so `state`
                  // never leaves idle for them -- without this they'd get
                  // haptic feedback (Vibration.vibrate above) but zero visual
                  // feedback on contact, which the spec requires immediately.
                  touchPressed && styles.btnPressedIn,
                ]}
              >
                <View style={[styles.accentBar, { backgroundColor: accent }]} />
                {state === 'error' ? <Text style={styles.errBadge}>!</Text> : null}
                <Text style={[styles.glyph, { color: accent }, state === 'pending' && styles.glyphPending]}>
                  {button.glyph ?? '▶'}
                </Text>
                <Text style={styles.lbl} numberOfLines={2}>{button.label.toUpperCase()}</Text>
                <Text style={styles.kind}>{button.kind.toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg, padding: theme.spacing.lg },
  empty: { color: theme.colors.textFaint, fontFamily: theme.font.regular, fontSize: 11, textAlign: 'center', marginTop: 48, letterSpacing: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  btn: {
    backgroundColor: theme.colors.bgAlt, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radii.card, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm,
    overflow: 'hidden',
  },
  btnPending: { borderColor: theme.colors.accentBorder },
  btnOk: { borderColor: theme.colors.accent },
  btnError: { borderColor: theme.colors.alert },
  // Immediate touch-down feedback for every button, including builtins
  // (which never enter the pending/ok/error ack state machine at all).
  btnPressedIn: { borderColor: theme.colors.accentBorder, backgroundColor: theme.colors.accentBg },
  accentBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, opacity: 0.55 },
  errBadge: { position: 'absolute', top: 8, right: 8, color: theme.colors.alert, fontFamily: theme.font.bold, fontSize: 12 },
  glyph: { fontSize: 26, fontFamily: theme.font.medium },
  glyphPending: { opacity: 0.4 },
  lbl: { color: theme.colors.textDim, fontFamily: theme.font.medium, fontSize: 10, letterSpacing: 1, textAlign: 'center', paddingHorizontal: 6 },
  kind: { color: theme.colors.textFainter, fontFamily: theme.font.regular, fontSize: 8, letterSpacing: 1 },
});
