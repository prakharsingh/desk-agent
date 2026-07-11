import type { CameraStatePayload } from '@desk-agent/protocol';

export type PresenceState = 'present' | 'maybe-absent' | 'absent';
// Derived from the protocol's CameraStatePayloadSchema rather than
// hand-copied, so adding/renaming a camera state is a single-source change
// instead of three independent literal unions drifting out of sync (see
// entrypoint.ts's subscribeSensor and app/src/presenceEvents.ts's
// buildCameraStateFrame, which now derive from the same schema).
export type CameraHealthState = CameraStatePayload['state'];

export interface PresenceEngineConfig {
  absenceTimeoutMs: number;
  gazeIsKeepAwake: boolean;
  bootConfirmationTimeoutMs: number;
}

export class PresenceEngine {
  private state: PresenceState = 'present';
  // cameraHealthy is derived from two independent signals rather than a
  // single hand-toggled latch:
  //   - cameraReportedHealthy: the phone's own camera pipeline, confirmed
  //     only by an explicit onCameraState('active'|'error'|'released')
  //     from the phone. This must stay conservative -- once the phone says
  //     its camera errored/released, only the phone saying 'active' again
  //     can clear it.
  //   - linkAlive: whether the Mac has heard from the phone recently. This
  //     is set false ONLY by a watchdog-timeout camera_state('error') (see
  //     main.ts's Watchdog wiring) and is a link-liveness signal, not a
  //     camera-health signal -- the phone never told us anything is wrong
  //     with its camera, we just stopped hearing from it. It is cleared by
  //     onLinkResumed(), called whenever the link produces any further
  //     traffic (see main.ts's onClientMessage wiring), without requiring
  //     a fresh camera_state('active').
  // Both must be true to arm absence. This closes a recovery gap where a
  // watchdog timeout permanently pinned presence "present": previously,
  // healing required a fresh onCameraState('active'), but the phone only
  // re-announces 'active' on a WS reconnect (via connectionEpoch) -- if the
  // phone merely paused sending (GC pause, doze) and resumed over the SAME
  // still-open socket, no reconnect ever happens, so cameraHealthy stayed
  // false forever and the display could never sleep again.
  private cameraReportedHealthy = false;
  private linkAlive = true;
  private absenceTimer?: NodeJS.Timeout;
  private bootTimer?: NodeJS.Timeout;
  private lastFaceVisible = false;
  private lastMotion = false;

  constructor(
    private config: PresenceEngineConfig,
    private onPresenceChange: (present: boolean) => void,
    private log: (level: string, message: string) => void,
  ) {
    this.bootTimer = setTimeout(() => {
      if (!this.cameraHealthy) {
        // Per spec: treat this exactly like onCameraState('error',
        // 'no-boot-confirmation') -- fail-to-present, not a silent
        // trust-through. This is defense-in-depth: maybeArmAbsence()'s own
        // cameraHealthy guard already prevents arming absence before boot
        // confirmation, so this rarely changes observable behavior today,
        // but it closes the gap if that guard is ever refactored.
        this.forceFailToPresent('no-boot-confirmation');
      }
    }, this.config.bootConfirmationTimeoutMs);
  }

  onFaceVisible(visible: boolean) {
    this.lastFaceVisible = visible;
    if (visible) this.refreshKeepAwake();
    else this.maybeArmAbsence();
  }

  onGaze(gazing: boolean) {
    // Gaze never SOLE presence: only refreshes keep-awake when face_visible
    // is also currently true. Structurally, MLKit gaze is always derived
    // from a detected face, so this is a hardening guard against a
    // malformed/buggy client sending gaze without ever sending face_visible.
    if (gazing && this.config.gazeIsKeepAwake && this.lastFaceVisible) {
      this.refreshKeepAwake();
    }
  }

  onMotion(active: boolean) {
    this.lastMotion = active;
    if (active) this.refreshKeepAwake();
    else this.maybeArmAbsence();
  }

  onCameraState(state: CameraHealthState, reason?: string) {
    if (state === 'active') {
      this.cameraReportedHealthy = true;
      this.linkAlive = true;
      this.clearBootTimer();
      return;
    }
    if (reason === 'watchdog-timeout') {
      // Link-only signal (see main.ts's Watchdog wiring): the phone never
      // reported a camera problem, we just stopped hearing from it. Track
      // this separately so a resumed link (onLinkResumed) can heal it
      // without requiring a fresh camera_state('active').
      this.linkAlive = false;
    } else {
      this.cameraReportedHealthy = false;
    }
    this.forceFailToPresent(reason ?? state);
  }

  /**
   * Call whenever the link produces fresh traffic after a watchdog-timeout
   * (e.g. main.ts's `onClientMessage`, alongside `watchdog.pulse()`). Only
   * clears a watchdog-induced unhealthy state; an explicit camera-reported
   * error/released (cameraReportedHealthy) is untouched and still requires
   * an explicit onCameraState('active') to clear, by design.
   */
  onLinkResumed() {
    this.linkAlive = true;
  }

  private get cameraHealthy(): boolean {
    return this.cameraReportedHealthy && this.linkAlive;
  }

  getState(): PresenceState {
    return this.state;
  }

  private forceFailToPresent(reason: string) {
    this.clearAbsenceTimer();
    this.clearBootTimer();
    const wasPresent = this.state === 'present';
    this.state = 'present';
    if (!wasPresent) this.onPresenceChange(true);
    this.log('info', `presence forced to present: ${reason}`);
  }

  private refreshKeepAwake() {
    this.clearAbsenceTimer();
    if (this.state !== 'present') {
      this.state = 'present';
      this.onPresenceChange(true);
    }
  }

  private maybeArmAbsence() {
    // Only arm once the camera is confirmed healthy -- an unhealthy camera
    // already forces 'present' via forceFailToPresent and must never
    // independently arm an absence timer.
    if (!this.cameraHealthy) return;
    if (this.lastFaceVisible || this.lastMotion) return;
    if (this.state === 'absent' || this.absenceTimer) return;
    this.state = 'maybe-absent';
    this.absenceTimer = setTimeout(() => {
      this.absenceTimer = undefined;
      this.state = 'absent';
      this.onPresenceChange(false);
    }, this.config.absenceTimeoutMs);
  }

  private clearAbsenceTimer() {
    if (this.absenceTimer) {
      clearTimeout(this.absenceTimer);
      this.absenceTimer = undefined;
    }
  }

  private clearBootTimer() {
    if (this.bootTimer) {
      clearTimeout(this.bootTimer);
      this.bootTimer = undefined;
    }
  }
}
