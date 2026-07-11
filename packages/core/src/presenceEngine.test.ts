import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PresenceEngine, Watchdog } from './index.js';
import type { PresenceEngineConfig } from './index.js';

const baseConfig: PresenceEngineConfig = {
  absenceTimeoutMs: 300000,
  gazeIsKeepAwake: true,
  bootConfirmationTimeoutMs: 300000,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('PresenceEngine', () => {
  it('starts present and does not fire onPresenceChange on construction', () => {
    const onPresenceChange = vi.fn();
    new PresenceEngine(baseConfig, onPresenceChange, vi.fn());
    expect(onPresenceChange).not.toHaveBeenCalled();
  });

  it('goes absent after absenceTimeoutMs of no face and no motion, once camera is confirmed healthy', () => {
    const onPresenceChange = vi.fn();
    const engine = new PresenceEngine(baseConfig, onPresenceChange, vi.fn());
    engine.onCameraState('active');
    engine.onFaceVisible(false);
    engine.onMotion(false);
    vi.advanceTimersByTime(baseConfig.absenceTimeoutMs);
    expect(onPresenceChange).toHaveBeenCalledWith(false);
  });

  it('does NOT go absent before the full window elapses (hysteresis, not "absent > N s")', () => {
    const onPresenceChange = vi.fn();
    const engine = new PresenceEngine(baseConfig, onPresenceChange, vi.fn());
    engine.onCameraState('active');
    engine.onFaceVisible(false);
    engine.onMotion(false);
    vi.advanceTimersByTime(baseConfig.absenceTimeoutMs - 1);
    expect(onPresenceChange).not.toHaveBeenCalled();
  });

  it('false-absent surrogate: periodic motion edges under the window never let absence complete', () => {
    const onPresenceChange = vi.fn();
    const engine = new PresenceEngine(baseConfig, onPresenceChange, vi.fn());
    engine.onCameraState('active');
    engine.onFaceVisible(false);
    for (let i = 0; i < 10; i++) {
      engine.onMotion(true);
      vi.advanceTimersByTime(60000);
      engine.onMotion(false);
      vi.advanceTimersByTime(60000);
    }
    expect(onPresenceChange).not.toHaveBeenCalledWith(false);
  });

  it('cancels a pending absence transition on any keep-awake edge mid-window', () => {
    const onPresenceChange = vi.fn();
    const engine = new PresenceEngine(baseConfig, onPresenceChange, vi.fn());
    engine.onCameraState('active');
    engine.onFaceVisible(false);
    engine.onMotion(false);
    vi.advanceTimersByTime(baseConfig.absenceTimeoutMs - 1000);
    engine.onMotion(true);
    vi.advanceTimersByTime(1000);
    expect(onPresenceChange).not.toHaveBeenCalledWith(false);
  });

  it('gaze alone never establishes or extends presence without an accompanying face_visible', () => {
    const onPresenceChange = vi.fn();
    const engine = new PresenceEngine(baseConfig, onPresenceChange, vi.fn());
    engine.onCameraState('active');
    engine.onFaceVisible(false);
    engine.onMotion(false);
    engine.onGaze(true); // face_visible was never true -- must be ignored
    vi.advanceTimersByTime(baseConfig.absenceTimeoutMs);
    expect(onPresenceChange).toHaveBeenCalledWith(false);
  });

  it('gaze extends keep-awake when accompanied by face_visible', () => {
    const onPresenceChange = vi.fn();
    const engine = new PresenceEngine(baseConfig, onPresenceChange, vi.fn());
    engine.onCameraState('active');
    engine.onFaceVisible(true);
    engine.onGaze(true);
    vi.advanceTimersByTime(baseConfig.absenceTimeoutMs);
    expect(onPresenceChange).not.toHaveBeenCalledWith(false);
  });

  it('camera error forces present and disarms any pending absence timer', () => {
    const onPresenceChange = vi.fn();
    const engine = new PresenceEngine(baseConfig, onPresenceChange, vi.fn());
    engine.onCameraState('active');
    engine.onFaceVisible(false);
    engine.onMotion(false);
    vi.advanceTimersByTime(baseConfig.absenceTimeoutMs - 1000);
    engine.onCameraState('error', 'permission-denied');
    vi.advanceTimersByTime(10000);
    expect(onPresenceChange).not.toHaveBeenCalledWith(false);
  });

  it('camera released also forces fail-to-present (not just error)', () => {
    const onPresenceChange = vi.fn();
    const engine = new PresenceEngine(baseConfig, onPresenceChange, vi.fn());
    engine.onCameraState('active');
    engine.onFaceVisible(false);
    engine.onMotion(false);
    engine.onCameraState('released');
    vi.advanceTimersByTime(baseConfig.absenceTimeoutMs);
    expect(onPresenceChange).not.toHaveBeenCalledWith(false);
  });

  it('never arms the absence timer while the camera has not yet been confirmed active', () => {
    const onPresenceChange = vi.fn();
    const engine = new PresenceEngine(baseConfig, onPresenceChange, vi.fn());
    engine.onFaceVisible(false);
    engine.onMotion(false);
    vi.advanceTimersByTime(baseConfig.absenceTimeoutMs * 2);
    expect(onPresenceChange).not.toHaveBeenCalledWith(false);
  });

  it('clears the boot-confirmation guard once camera_state active arrives, allowing normal absence tracking after', () => {
    const onPresenceChange = vi.fn();
    const config = { ...baseConfig, bootConfirmationTimeoutMs: 5000 };
    const engine = new PresenceEngine(config, onPresenceChange, vi.fn());
    vi.advanceTimersByTime(4000);
    engine.onCameraState('active');
    engine.onFaceVisible(false);
    engine.onMotion(false);
    vi.advanceTimersByTime(config.absenceTimeoutMs);
    expect(onPresenceChange).toHaveBeenCalledWith(false);
  });

  it('treats bootConfirmationTimeoutMs elapsing with no camera_state exactly like an explicit onCameraState(error, no-boot-confirmation) call', () => {
    // Reuse forceFailToPresent's own log line (not a bespoke warn message) --
    // this is the behavioral proof that the boot timeout takes the *same*
    // code path as an explicit camera error, per the spec's defense-in-depth
    // mandate, not a parallel log-only branch that silently trusts through.
    const log = vi.fn();
    const config = { ...baseConfig, bootConfirmationTimeoutMs: 5000 };
    const engine = new PresenceEngine(config, vi.fn(), log);
    vi.advanceTimersByTime(5000);
    expect(engine.getState()).toBe('present');
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('no-boot-confirmation'));
  });

  it('boot-confirmation timeout disarms a pending absence timer exactly like an explicit camera error would, once camera later reports healthy then unhealthy again is simulated via direct forceFailToPresent semantics', () => {
    // Behavioral parity check: fire the boot timeout with no camera_state
    // ever received, then confirm the engine is in the same state a real
    // onCameraState('error', 'no-boot-confirmation') call would leave it in
    // -- present, with cameraHealthy still false, so a later spurious
    // onFaceVisible/onMotion(false) cannot arm an absence timer.
    const onPresenceChange = vi.fn();
    const config = { ...baseConfig, bootConfirmationTimeoutMs: 5000 };
    const engine = new PresenceEngine(config, onPresenceChange, vi.fn());
    vi.advanceTimersByTime(5000); // boot timer fires: forceFailToPresent('no-boot-confirmation')
    engine.onFaceVisible(false);
    engine.onMotion(false);
    vi.advanceTimersByTime(config.absenceTimeoutMs * 2);
    expect(engine.getState()).toBe('present');
    expect(onPresenceChange).not.toHaveBeenCalledWith(false);
  });

  it('a simulated watchdog link-death (camera_state error with reason watchdog-timeout) forces fail-to-present exactly like an explicit camera error', () => {
    const onPresenceChange = vi.fn();
    const engine = new PresenceEngine(baseConfig, onPresenceChange, vi.fn());
    engine.onCameraState('active');
    engine.onFaceVisible(false);
    engine.onMotion(false);
    vi.advanceTimersByTime(baseConfig.absenceTimeoutMs - 1000);
    engine.onCameraState('error', 'watchdog-timeout');
    vi.advanceTimersByTime(10000);
    expect(onPresenceChange).not.toHaveBeenCalledWith(false);
  });

  it('onLinkResumed heals a watchdog-timeout-induced unhealthy state, letting absence arm again on a subsequent edge', () => {
    const onPresenceChange = vi.fn();
    const engine = new PresenceEngine(baseConfig, onPresenceChange, vi.fn());
    engine.onCameraState('active');
    engine.onFaceVisible(false);
    engine.onMotion(false);
    vi.advanceTimersByTime(baseConfig.absenceTimeoutMs - 1000);

    // Watchdog fires: link presumed dead, forces present, pins cameraHealthy.
    engine.onCameraState('error', 'watchdog-timeout');
    // Time well past what would have been the original absence deadline --
    // must NOT go absent while still pinned unhealthy.
    vi.advanceTimersByTime(60000);
    expect(onPresenceChange).not.toHaveBeenCalledWith(false);

    // Link resumes (phone kept sending on the same still-open socket, no
    // reconnect, so no fresh camera_state('active') was ever re-announced).
    engine.onLinkResumed();
    // A face/motion edge is needed to re-arm (onLinkResumed alone doesn't
    // arm anything, it only clears the health gate).
    engine.onFaceVisible(false);
    engine.onMotion(false);
    vi.advanceTimersByTime(baseConfig.absenceTimeoutMs);
    expect(onPresenceChange).toHaveBeenCalledWith(false);
  });

  it('onLinkResumed does NOT heal an explicit camera-reported error/released -- only an explicit onCameraState(active) can', () => {
    const onPresenceChange = vi.fn();
    const engine = new PresenceEngine(baseConfig, onPresenceChange, vi.fn());
    engine.onCameraState('active');
    engine.onFaceVisible(false);
    engine.onMotion(false);

    // The PHONE explicitly reports its camera errored -- not a watchdog
    // inference. This must stay sticky.
    engine.onCameraState('error', 'permission-denied');
    engine.onLinkResumed(); // must be a no-op for a camera-reported fault
    engine.onFaceVisible(false);
    engine.onMotion(false);
    vi.advanceTimersByTime(baseConfig.absenceTimeoutMs * 2);
    expect(onPresenceChange).not.toHaveBeenCalledWith(false);

    // Only an explicit 'active' clears it.
    engine.onCameraState('active');
    engine.onFaceVisible(false);
    engine.onMotion(false);
    vi.advanceTimersByTime(baseConfig.absenceTimeoutMs);
    expect(onPresenceChange).toHaveBeenCalledWith(false);
  });

  describe('real Watchdog -> PresenceEngine wiring (matches main.ts composition)', () => {
    // main.ts wires: new Watchdog(WATCHDOG_TIMEOUT_MS, () => {
    //   log(...); presenceEngine.onCameraState('error', 'watchdog-timeout');
    // });
    // This is the single most safety-critical cross-module connection this
    // slice adds -- it's what prevents a silently-killed phone app from
    // causing a false-absent sleep. Unlike integration.test.ts's fail-to-present
    // test (which simulates this by publishing camera_state:error directly
    // through the EventBus), this constructs a REAL Watchdog instance and
    // exercises the actual closure that connects Watchdog.onMissed to
    // presenceEngine.onCameraState(...).
    const WATCHDOG_TIMEOUT_MS = 30000; // must match main.ts's WATCHDOG_TIMEOUT_MS

    it('a real Watchdog timing out with no pulse() drives the real PresenceEngine to fail-to-present via the exact main.ts wiring', () => {
      const onPresenceChange = vi.fn();
      const engine = new PresenceEngine(baseConfig, onPresenceChange, vi.fn());
      const watchdog = new Watchdog(WATCHDOG_TIMEOUT_MS, () => {
        engine.onCameraState('error', 'watchdog-timeout');
      });

      // Get the engine into a state where absence is pending, with more
      // time left on the pending absence timer than the watchdog timeout,
      // so the watchdog firing first has an observable effect if the
      // wiring works, and none if it doesn't -- proving the wiring, not
      // just default 'present' state.
      engine.onCameraState('active');
      engine.onFaceVisible(false);
      engine.onMotion(false);
      vi.advanceTimersByTime(baseConfig.absenceTimeoutMs - WATCHDOG_TIMEOUT_MS - 1000);

      watchdog.start();
      vi.advanceTimersByTime(WATCHDOG_TIMEOUT_MS); // watchdog fires onMissed -> onCameraState('error', ...)

      // Continue past what would have been the original absence deadline:
      // if the real wiring worked, forceFailToPresent disarmed the pending
      // absence timer, so presence must NOT have gone absent.
      vi.advanceTimersByTime(10000);

      expect(engine.getState()).toBe('present');
      expect(onPresenceChange).not.toHaveBeenCalledWith(false);
    });

    it('pulsing the real Watchdog before its timeout means the real PresenceEngine never sees a watchdog-triggered camera error', () => {
      const onPresenceChange = vi.fn();
      const engine = new PresenceEngine(baseConfig, onPresenceChange, vi.fn());
      const onCameraStateSpy = vi.spyOn(engine, 'onCameraState');
      const watchdog = new Watchdog(WATCHDOG_TIMEOUT_MS, () => {
        engine.onCameraState('error', 'watchdog-timeout');
      });

      watchdog.start();
      vi.advanceTimersByTime(WATCHDOG_TIMEOUT_MS - 1000);
      watchdog.pulse();
      vi.advanceTimersByTime(WATCHDOG_TIMEOUT_MS - 1000);

      expect(onCameraStateSpy).not.toHaveBeenCalledWith('error', 'watchdog-timeout');
    });

    it('a resumed client message after a real watchdog timeout heals via onLinkResumed, exactly as main.ts wires onClientMessage', () => {
      // Reproduces main.ts's exact composition:
      //   const watchdog = new Watchdog(WATCHDOG_TIMEOUT_MS, () => {
      //     presenceEngine.onCameraState('error', 'watchdog-timeout');
      //   });
      //   ...
      //   onClientMessage: () => { watchdog.pulse(); presenceEngine.onLinkResumed(); }
      //
      // Uses a short absenceTimeoutMs (unlike baseConfig's 300s) so the
      // re-armed absence timer completes well before the real Watchdog's own
      // pulse()-renewed timer would next fire (30s) -- this test isolates
      // onLinkResumed's healing contract from the separate, larger question
      // of whether real-world traffic cadence keeps the watchdog satisfied
      // throughout a multi-minute quiet absence (it currently does not,
      // since the phone sends no periodic idle traffic -- a distinct,
      // deeper gap flagged separately, not fixed by onLinkResumed alone).
      const config = { ...baseConfig, absenceTimeoutMs: 5000 };
      const onPresenceChange = vi.fn();
      const engine = new PresenceEngine(config, onPresenceChange, vi.fn());
      const watchdog = new Watchdog(WATCHDOG_TIMEOUT_MS, () => {
        engine.onCameraState('error', 'watchdog-timeout');
      });
      const onClientMessage = () => {
        watchdog.pulse();
        engine.onLinkResumed();
      };

      engine.onCameraState('active');
      engine.onFaceVisible(false);
      engine.onMotion(false);

      watchdog.start();
      vi.advanceTimersByTime(WATCHDOG_TIMEOUT_MS); // watchdog fires -> forced present, link marked dead

      // The phone was never actually gone -- it resumes sending frames over
      // the SAME socket (no WS reconnect, so no connectionEpoch bump on the
      // phone side and no re-announced camera_state('active')). Each such
      // message drives onClientMessage exactly as the real gateway wiring
      // does.
      onClientMessage();
      engine.onFaceVisible(false);
      engine.onMotion(false);

      // Absence must now be able to complete -- proving the link healed
      // without requiring a fresh onCameraState('active'). Well under the
      // watchdog's own 30s pulse()-renewed interval, so no second spurious
      // fire interferes.
      vi.advanceTimersByTime(config.absenceTimeoutMs);
      expect(onPresenceChange).toHaveBeenCalledWith(false);
    });

    it('a real quiet absence completes to sleep: periodic 5s heartbeat-ack pulses (app/src/wsClient.ts) keep the real Watchdog satisfied for the whole 5min absenceTimeoutMs even with zero further sensor edges', () => {
      // Edge-only sensor emission (edgeEmitter.ts) means that once someone
      // leaves and the departure edges fire, the phone sends NOTHING further
      // for as long as nothing changes -- there is no periodic sensor
      // traffic to lean on. Before wsClient.ts acked the server's periodic
      // heartbeat frame, that left the phone completely silent
      // client->server for the whole absence window, and this 30s watchdog
      // (dramatically shorter than the default 300s absenceTimeoutMs) would
      // have repeatedly and falsely concluded the link was dead, forcing
      // presence back to "present" over and over and preventing the display
      // from EVER auto-sleeping during a real, quiet absence -- the core
      // scenario Slice 1b exists to handle. This test proves the fix: with
      // the phone's new heartbeat ack (WsGateway broadcasts one every
      // heartbeatMs=5000ms, wsClient.ts acks it unconditionally, independent
      // of sensor activity), the watchdog stays satisfied throughout and
      // absence completes normally.
      const onPresenceChange = vi.fn();
      const engine = new PresenceEngine(baseConfig, onPresenceChange, vi.fn());
      const watchdog = new Watchdog(WATCHDOG_TIMEOUT_MS, () => {
        engine.onCameraState('error', 'watchdog-timeout');
      });
      const HEARTBEAT_ACK_INTERVAL_MS = 5000; // matches WsGateway's heartbeatMs

      engine.onCameraState('active');
      watchdog.start();

      // Person leaves: one settling edge pair, then -- per edge-only
      // emission -- zero further sensor traffic for the rest of the window.
      engine.onFaceVisible(false);
      engine.onMotion(false);

      let elapsed = 0;
      while (elapsed < baseConfig.absenceTimeoutMs) {
        vi.advanceTimersByTime(HEARTBEAT_ACK_INTERVAL_MS);
        elapsed += HEARTBEAT_ACK_INTERVAL_MS;
        watchdog.pulse(); // simulates wsClient.ts's periodic heartbeat ack
      }

      expect(engine.getState()).toBe('absent');
      expect(onPresenceChange).toHaveBeenCalledWith(false);
    });
  });

  describe('onGenuineReturn (Slice 1c wake trigger)', () => {
    it('does NOT fire on construction (boot-default present, no edge occurred)', () => {
      const onGenuineReturn = vi.fn();
      new PresenceEngine(baseConfig, vi.fn(), vi.fn(), onGenuineReturn);
      expect(onGenuineReturn).not.toHaveBeenCalled();
    });

    it('fires when a face-visible edge brings the engine back from absent to present', () => {
      const onGenuineReturn = vi.fn();
      const engine = new PresenceEngine(baseConfig, vi.fn(), vi.fn(), onGenuineReturn);
      engine.onCameraState('active');
      engine.onFaceVisible(false);
      engine.onMotion(false);
      vi.advanceTimersByTime(baseConfig.absenceTimeoutMs);
      expect(engine.getState()).toBe('absent');
      onGenuineReturn.mockClear();

      engine.onFaceVisible(true);
      expect(onGenuineReturn).toHaveBeenCalledTimes(1);
    });

    it('fires when a motion edge brings the engine back from absent to present', () => {
      const onGenuineReturn = vi.fn();
      const engine = new PresenceEngine(baseConfig, vi.fn(), vi.fn(), onGenuineReturn);
      engine.onCameraState('active');
      engine.onFaceVisible(false);
      engine.onMotion(false);
      vi.advanceTimersByTime(baseConfig.absenceTimeoutMs);
      expect(engine.getState()).toBe('absent');
      onGenuineReturn.mockClear();

      engine.onMotion(true);
      expect(onGenuineReturn).toHaveBeenCalledTimes(1);
    });

    // Gaze cannot be tested as an independent trigger: onGaze() only calls
    // refreshKeepAwake() when this.lastFaceVisible is already true (see
    // presenceEngine.ts's onGaze), and lastFaceVisible only ever becomes
    // true via onFaceVisible(true), which itself already calls
    // refreshKeepAwake() through the face_visible path. There is no reachable
    // sequence where gaze is the exclusive cause of an absent->present edge.

    it('does NOT fire when a camera error forces present from maybe-absent (fail-safe, not a genuine return)', () => {
      const onGenuineReturn = vi.fn();
      const engine = new PresenceEngine(baseConfig, vi.fn(), vi.fn(), onGenuineReturn);
      engine.onCameraState('active');
      engine.onFaceVisible(false);
      engine.onMotion(false);
      vi.advanceTimersByTime(baseConfig.absenceTimeoutMs - 1000); // still maybe-absent
      onGenuineReturn.mockClear();

      engine.onCameraState('error', 'permission-denied'); // forces present via forceFailToPresent
      expect(onGenuineReturn).not.toHaveBeenCalled();
    });

    it('does NOT fire when a watchdog-timeout forces present from maybe-absent (fail-safe, not a genuine return)', () => {
      const onGenuineReturn = vi.fn();
      const engine = new PresenceEngine(baseConfig, vi.fn(), vi.fn(), onGenuineReturn);
      engine.onCameraState('active');
      engine.onFaceVisible(false);
      engine.onMotion(false);
      vi.advanceTimersByTime(baseConfig.absenceTimeoutMs - 1000); // still maybe-absent
      onGenuineReturn.mockClear();

      engine.onCameraState('error', 'watchdog-timeout'); // forces present via forceFailToPresent
      expect(onGenuineReturn).not.toHaveBeenCalled();
    });

    it('does NOT fire when the boot-confirmation timer elapses with no camera_state ever received', () => {
      // The engine starts in 'present' by default and cannot arm absence
      // before boot confirmation (maybeArmAbsence's cameraHealthy guard), so
      // forceFailToPresent('no-boot-confirmation') fires with wasPresent
      // already true -- neither onPresenceChange nor onGenuineReturn are
      // called in this specific path. Asserted here for documentation and
      // regression coverage, not because it's a live risk.
      const onPresenceChange = vi.fn();
      const onGenuineReturn = vi.fn();
      const config = { ...baseConfig, bootConfirmationTimeoutMs: 5000 };
      new PresenceEngine(config, onPresenceChange, vi.fn(), onGenuineReturn);
      vi.advanceTimersByTime(5000);
      expect(onPresenceChange).not.toHaveBeenCalled();
      expect(onGenuineReturn).not.toHaveBeenCalled();
    });

    it('is safe to omit entirely -- engine still functions with only the original 3 constructor args', () => {
      const onPresenceChange = vi.fn();
      const engine = new PresenceEngine(baseConfig, onPresenceChange, vi.fn());
      engine.onCameraState('active');
      engine.onFaceVisible(false);
      engine.onMotion(false);
      vi.advanceTimersByTime(baseConfig.absenceTimeoutMs);
      expect(onPresenceChange).toHaveBeenCalledWith(false);
      expect(() => engine.onFaceVisible(true)).not.toThrow();
    });
  });
});
