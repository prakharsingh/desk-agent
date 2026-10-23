import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { DisplaySessionPayload } from '@desk-agent/protocol';
import { theme } from '../theme.js';
import { Toggle } from '../ui/Toggle.js';
import { buildDisplayStartFrame, buildDisplayStopFrame } from '../../displayFrames.js';
import {
  INITIAL_DISPLAY_FLOW,
  canRetryDisplay,
  displayReasonCopy,
  isStaleDisplayReply,
  noteDisplaySessionSeen,
  reduceDisplayFlow,
  type SeenDisplaySessions,
  type DisplayEffect,
  type DisplayFlowEvent,
  type DisplayFlowState,
} from '../displayFlow.js';
import { DisplayView, displayNative, subscribeDisplayEvents } from '../displayNative.js';

export interface DisplayScreenProps {
  lastSession: { payload: DisplaySessionPayload; seq: number } | null;
  // App-lifetime record of display sessionIds already seen (id -> seq of the
  // frame that first carried it). App.tsx records every display.session frame
  // on arrival; this screen also records the sessions it starts natively.
  seenSessionIds: SeenDisplaySessions;
  // App's display.session frame counter right now (not the possibly older
  // `lastSession.seq`, which lags behind batched frames).
  getDisplaySeq: () => number;
  jsonConnected: boolean;
  sendFrame: (json: string) => void;
  onExit: () => void;
  onUnsupported: () => void;
  onSupported: () => void;
}

const TICK_MS = 1000;

type NativeStateEvent = Extract<DisplayFlowEvent, { type: 'nativeState' }>;

export function DisplayScreen({ lastSession, seenSessionIds, getDisplaySeq, jsonConnected, sendFrame, onExit, onUnsupported, onSupported }: DisplayScreenProps) {
  // The reducer state lives in a ref so every dispatch composes on the latest
  // state (several native events can land between renders) and the unmount
  // cleanup never reads a stale closure. Every effect-bearing reducer step
  // yields a new state object, so setFlow also re-renders to drain the queue.
  const flowRef = useRef<DisplayFlowState>(INITIAL_DISPLAY_FLOW);
  const effectQueueRef = useRef<DisplayEffect[]>([]);
  const [flow, setFlow] = useState<DisplayFlowState>(INITIAL_DISPLAY_FLOW);
  // Try agains in a row this visit with no streaming session in between (drives the failure copy).
  const [retries, setRetries] = useState(0);
  const [showExit, setShowExitState] = useState(false);
  const showExitRef = useRef(false);
  const setShowExit = useCallback((v: boolean) => {
    showExitRef.current = v;
    setShowExitState(v);
  }, []);

  // Trackpad mode lives here (not in the overlay) so it survives the overlay
  // closing; native resets it to off on every session start, and so does this.
  // The ref keeps the native call out of a state updater (StrictMode runs those twice).
  const [trackpad, setTrackpadState] = useState(false);
  const trackpadRef = useRef(false);
  const setTrackpad = useCallback((on: boolean) => {
    trackpadRef.current = on;
    setTrackpadState(on);
  }, []);
  const toggleTrackpad = useCallback(() => {
    const next = !trackpadRef.current;
    setTrackpad(next);
    displayNative.setTrackpadMode(next);
  }, [setTrackpad]);

  const latest = useRef({ sendFrame, onExit, onUnsupported, onSupported, jsonConnected, seenSessionIds, getDisplaySeq });
  latest.current = { sendFrame, onExit, onUnsupported, onSupported, jsonConnected, seenSessionIds, getDisplaySeq };
  // App's frame counter at the moment this screen sent display.start: ids first
  // seen at or before it belong to an earlier start and are stale replies.
  const startSeqRef = useRef<number | null>(null);

  const dispatch = useCallback((event: DisplayFlowEvent) => {
    const result = reduceDisplayFlow(flowRef.current, event);
    flowRef.current = result.state;
    if (result.effects.length > 0) effectQueueRef.current.push(...result.effects);
    setFlow(result.state);
  }, []);

  // Drain the queue after every render: each effect was pushed exactly once by
  // a dispatch and is removed here, so a StrictMode double-invoked effect (or a
  // re-render with unchanged state) can never run it twice.
  useEffect(() => {
    const queue = effectQueueRef.current;
    if (queue.length === 0) return;
    effectQueueRef.current = [];
    for (const effect of queue) {
      switch (effect.kind) {
        case 'sendStart':
          startSeqRef.current = latest.current.getDisplaySeq();
          latest.current.sendFrame(JSON.stringify(buildDisplayStartFrame(effect.size)));
          break;
        case 'sendStop':
          latest.current.sendFrame(JSON.stringify(buildDisplayStopFrame(effect.sessionId, effect.reason)));
          break;
        case 'nativeStart':
          noteDisplaySessionSeen(latest.current.seenSessionIds, effect.sessionId, 0);
          setTrackpad(false);
          displayNative.start(effect.sessionId, effect.videoPort);
          break;
        case 'nativeStop':
          displayNative.stop();
          break;
        case 'goHome':
          latest.current.onExit();
          break;
      }
    }
  });

  // Native events (surface size starts the flow; state drives streaming/failed).
  useEffect(() => {
    const unsubscribe = subscribeDisplayEvents({
        onSize: (size) =>
          dispatch({
            type: 'surfaceSize',
            size,
            linkConnected: latest.current.jsonConnected,
            now: Date.now(),
          }),
        onState: (e) => dispatch({ type: 'nativeState', state: e.state as NativeStateEvent['state'], reason: e.reason, inputEnabled: e.inputEnabled }),
    });
    // The surface may have reported its size before we subscribed.
    displayNative.requestSize();
    return unsubscribe;
  }, [dispatch]);

  // Reply timeout clock.
  useEffect(() => {
    const id = setInterval(() => dispatch({ type: 'tick', now: Date.now() }), TICK_MS);
    return () => clearInterval(id);
  }, [dispatch]);

  // display.session replies from core. Each seq is processed once; a value that
  // was already present at mount belongs to a previous visit and is ignored.
  const lastSeqRef = useRef<number | null>(lastSession?.seq ?? null);
  useEffect(() => {
    if (!lastSession || lastSession.seq === lastSeqRef.current) return;
    lastSeqRef.current = lastSession.seq;
    const { payload, seq } = lastSession;
    if (payload.state === 'ready') latest.current.onSupported();
    // Staleness is judged against the counter captured when display.start was
    // sent, not this frame's seq: ids first seen after the start are never
    // stale, even when only a later duplicate frame reaches this effect.
    const seen = latest.current.seenSessionIds;
    const stale = isStaleDisplayReply(seen, payload.sessionId, startSeqRef.current);
    noteDisplaySessionSeen(seen, payload.sessionId, seq);
    dispatch({ type: 'sessionReply', payload, stale });
  }, [lastSession, dispatch]);

  useEffect(() => {
    if (flow.phase === 'streaming') setRetries(0);
  }, [flow.phase]);

  // Report "unsupported" once, when the flow lands in that failure.
  useEffect(() => {
    if (flow.phase === 'failed' && flow.reason === 'unsupported') latest.current.onUnsupported();
  }, [flow]);

  // The exit prompt only applies to a pending or live session; drop it once the flow leaves those.
  useEffect(() => {
    if (flow.phase !== 'requesting' && flow.phase !== 'starting' && flow.phase !== 'streaming') setShowExit(false);
  }, [flow.phase, setShowExit]);

  // Hardware back: a live (or pending) session asks first; otherwise just leave.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showExitRef.current) {
        setShowExit(false); // back on the overlay = Stay
        return true;
      }
      switch (flowRef.current.phase) {
        case 'requesting':
        case 'starting':
        case 'streaming':
          setShowExit(true);
          return true;
        case 'measuring':
        case 'failed':
          dispatch({ type: 'userExit' });
          return true;
        default:
          return true;
      }
    });
    return () => sub.remove();
  }, [dispatch, setShowExit]);

  // Leaving the screen by any route always ends a live session (spec 6.5). A
  // session that userExit / a failure already ended is `exited` / `failed` in
  // the ref by now, so this never double-sends stop.
  useEffect(
    () => () => {
      const phase = flowRef.current;
      if (phase.phase === 'starting' || phase.phase === 'streaming') {
        displayNative.stop();
        latest.current.sendFrame(JSON.stringify(buildDisplayStopFrame(phase.sessionId, 'user-exit')));
      } else if (phase.phase === 'requesting') {
        // The Mac may still answer ready; tell it we are gone (spec 6.5).
        latest.current.sendFrame(JSON.stringify(buildDisplayStopFrame(null, 'user-exit')));
      }
    },
    [],
  );

  const confirmExit = () => {
    setShowExit(false);
    dispatch({ type: 'userExit' });
  };

  if (flow.phase === 'failed') {
    return (
      <View style={styles.center}>
        <Text style={styles.failure}>{displayReasonCopy(flow.reason, flow.midSession === true, retries)}</Text>
        <View style={styles.dialogRow}>
          <Pressable onPress={() => dispatch({ type: 'userExit' })} style={styles.button} accessibilityRole="button">
            <Text style={styles.buttonText}>Back</Text>
          </Pressable>
          {canRetryDisplay(flow.reason) && (
            <Pressable
              onPress={() => {
                setRetries((n) => n + 1);
                dispatch({ type: 'retry' });
              }}
              style={styles.button}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>Try again</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  // Terminal: the screen is about to leave (goHome is queued). Never mount the
  // display SurfaceView here; its window hole outlives its unmount on device.
  if (flow.phase === 'exited') {
    return <View style={styles.root} />;
  }

  const status =
    flow.phase === 'measuring' ? 'Preparing display…' : flow.phase === 'requesting' ? 'Asking the Mac for a display…' : flow.phase === 'starting' ? 'Connecting…' : null;

  return (
    <View style={styles.root}>
      <DisplayView style={StyleSheet.absoluteFill} />
      {status !== null && (
        <View style={styles.status} pointerEvents="none">
          <Text style={styles.statusText}>{status}</Text>
        </View>
      )}
      {/* The prompt gets its own window (a Dialog). The SurfaceView behind the
          activity window punches a hole in it that is only recomputed on a root
          layout, which Fabric never requests, so views mounted over a live
          video in this window are composited away (F1). Back in the Modal's
          window reaches onRequestClose, not BackHandler: it means Stay. */}
      <Modal
        visible={showExit}
        transparent
        animationType="none"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setShowExit(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Exit display?</Text>
            <View style={styles.optionRow}>
              <Text style={styles.optionText}>Trackpad mode</Text>
              <Toggle on={trackpad} onToggle={toggleTrackpad} label="Trackpad mode" />
            </View>
            {flow.phase === 'streaming' && !flow.inputEnabled && (
              <Text style={styles.hint}>Touch is off — allow Accessibility for Desk Agent on your Mac</Text>
            )}
            <View style={styles.dialogRow}>
              <Pressable onPress={() => setShowExit(false)} style={styles.button} accessibilityRole="button">
                <Text style={styles.buttonText}>Stay</Text>
              </Pressable>
              <Pressable onPress={confirmExit} style={[styles.button, styles.exitButton]} accessibilityRole="button">
                <Text style={styles.buttonText}>Exit</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.lg,
  },
  failure: { fontSize: 16, color: theme.colors.text, fontFamily: theme.font.regular, textAlign: 'center' },
  status: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  statusText: { fontSize: 14, color: theme.colors.textDim, fontFamily: theme.font.regular },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialog: {
    backgroundColor: theme.colors.bgAlt,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radii.card,
    padding: theme.spacing.xl,
    gap: theme.spacing.lg,
    alignItems: 'center',
  },
  dialogTitle: { fontSize: 16, color: theme.colors.text, fontFamily: theme.font.semibold },
  dialogRow: { flexDirection: 'row', gap: theme.spacing.md },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  optionText: { fontSize: 14, color: theme.colors.text, fontFamily: theme.font.regular },
  hint: { fontSize: 13, color: theme.colors.textDim, fontFamily: theme.font.regular, textAlign: 'center', maxWidth: 280 },
  button: {
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.accentBorder,
    backgroundColor: theme.colors.accentBg,
  },
  exitButton: { borderColor: theme.colors.warnBorder, backgroundColor: theme.colors.warnBg },
  buttonText: { fontSize: 13, color: theme.colors.text, fontFamily: theme.font.medium },
});
