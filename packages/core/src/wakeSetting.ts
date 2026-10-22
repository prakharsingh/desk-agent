export type WakeChangeSource = 'mac' | 'phone';

export interface WakeSettingSinks {
  /** Push the live value to every connected phone (action.invoke phone-display/setWakeEnabled). */
  sendToPhone(enabled: boolean): void;
  /** Report every applied change (any source) to the Mac app, which persists core's latest value to config.json. */
  notifyApp(enabled: boolean, source: WakeChangeSource): void;
}

// Live, mutable holder for presence.wakeEnabled. config.json (owned by the
// Mac app) stays the source of truth and seeds the initial value at boot;
// after that, both the Mac (ToCore setWakeEnabled) and the phone
// (event.publish presence.wakeEnabled) change it here WITHOUT a core restart,
// and the wake-on-return automation rule reads get() on every evaluation.
//
// Core is the serialization point. Every applied change is re-broadcast to
// phones (keeps all phones -- and the originating one -- converged on core's
// value) AND reported to the Mac app with its source, in apply order; main
// persists whatever core last reported (skipping equal writes, so the echo
// of a Mac toggle it already persisted optimistically is a no-op). Reporting
// only phone changes let a simultaneous Mac + phone toggle leave config.json
// disagreeing with core: main persisted a late phone report AFTER the Mac
// value core applied last. Setting the current value is a no-op (no
// rebroadcast, no report).
export class WakeSetting {
  constructor(private enabled: boolean, private sinks: WakeSettingSinks) {}

  get(): boolean {
    return this.enabled;
  }

  set(enabled: boolean, source: WakeChangeSource) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.sinks.sendToPhone(enabled);
    this.sinks.notifyApp(enabled, source);
  }
}
