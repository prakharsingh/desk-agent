import Foundation

/// Pure encode policy for the capture pipeline. The caller (`CaptureEncoder`) always retains the
/// latest complete sample as the "held frame"; the gate decides when to encode it.
///
/// Whenever a method returns `true` the caller encodes the held frame now, as an IDR if
/// `keyframePending` was true *before* the call (the call consumes the pending keyframe):
///
///     let idr = gate.keyframePending
///     if gate.sampleArrived(at: t, canSend: ok) { encode(held, forceKeyframe: idr) }
public struct FrameGate: Sendable {
    public let frameInterval: TimeInterval

    public private(set) var keyframePending = false
    public private(set) var hasHeldFrame = false
    /// The held frame was never handed to the encoder (it arrived while the window was closed).
    public private(set) var heldFrameUnencoded = false

    private var forcedAt: TimeInterval?

    public init(frameInterval: TimeInterval) {
        self.frameInterval = frameInterval
    }

    /// A new complete sample replaced the held frame. `true` → encode it now; `false` → keep it as
    /// the held frame, marked unencoded.
    public mutating func sampleArrived(at t: TimeInterval, canSend: Bool) -> Bool {
        hasHeldFrame = true
        guard canSend else {
            heldFrameUnencoded = true
            return false
        }
        markEncoded()
        return true
    }

    /// The flow-control window reopened. `true` → encode the held frame (only if it is unencoded).
    public mutating func unblocked(at t: TimeInterval) -> Bool {
        guard hasHeldFrame, heldFrameUnencoded else { return false }
        markEncoded()
        return true
    }

    /// The next encode must be an IDR. If no sample arrives within one frame interval, `tick` re-encodes
    /// the held frame.
    public mutating func keyframeForced(at t: TimeInterval) {
        keyframePending = true
        forcedAt = t
    }

    /// `true` → re-encode the held frame as an IDR: a keyframe was forced, no new sample arrived
    /// within one frame interval, and a held frame exists.
    public mutating func tick(at t: TimeInterval, canSend: Bool) -> Bool {
        guard keyframePending, canSend, hasHeldFrame, let forced = forcedAt,
              t - forced >= frameInterval else { return false }
        // A sample encoded after the force already consumed `keyframePending`, so reaching here means
        // no new sample went out as the IDR: re-encode the held frame (static screen).
        markEncoded()
        return true
    }

    private mutating func markEncoded() {
        heldFrameUnencoded = false
        keyframePending = false
        forcedAt = nil
    }
}
