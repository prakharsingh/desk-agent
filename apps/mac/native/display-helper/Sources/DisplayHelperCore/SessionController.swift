import CoreGraphics
import Foundation

/// The system side of a session: virtual display + capture/encode. Implemented over
/// `VirtualDisplayController` + `CaptureEncoder` in DisplayHelperSystem (Task 1.7).
public protocol DisplayBackend: AnyObject {
    func preflightScreenRecording() -> Bool
    func preflightPostEvent() -> Bool
    /// Whether the Mac's main display is asleep (`CGDisplayIsAsleep(CGMainDisplayID())`). Consulted
    /// only to explain a start failure.
    func mainDisplayAsleep() -> Bool
    /// Whether our virtual display is still part of the desktop (`CGDisplayIsOnline`). Consulted after
    /// `ready`, on a capture failure or a reconfiguration, to tell "switched off" from a capture fault.
    func displayIsOnline() -> Bool
    /// Whether our virtual display is in a macOS mirror set (`MirrorCheck.verdict`), with the queries that
    /// fired; `.unknown` while CoreGraphics in this process cannot tell yet (F-M1), never a mirror.
    /// Read-only: nothing in the helper ever changes a mirror set or the user's saved display arrangement.
    func mirrorVerdict() -> MirrorVerdict
    /// Runs `work` on the session queue after `delay` (never inline on the real backend).
    func runLater(after delay: TimeInterval, _ work: @escaping () -> Void)
    /// Creates the virtual display (no modes yet; `applyModes` follows). Returns its display id.
    func createDisplay(maxPixels: Int, sizeInMillimeters: CGSize, serialNum: UInt32,
                       vendorId: UInt32, productId: UInt32) throws -> UInt32
    func waitUntilCapturable(displayId: UInt32, timeout: TimeInterval,
                             completion: @escaping (Result<Void, BackendError>) -> Void)
    /// Returns before capture has started: asynchronous start failures are reported through
    /// `SessionController.captureError(_:)`.
    func startCapture(width: Int, height: Int, showsCursor: Bool) throws
    func stopCapture()
    func forceKeyframe()
    /// `CaptureEncoder.unblocked()`: encode the held frame if it was never encoded.
    func unblocked()
    func setShowsCursor(_ on: Bool)
    /// Applies `modes` (preferred first) and activates a usable HiDPI one. Activation is polled for up
    /// to 3 s OFF the session queue; `completion` is delivered later on the session queue (never
    /// inline on the real backend), so keepalives, `stop` and signals are handled meanwhile.
    func applyModes(_ modes: [ModeSpec], completion: @escaping (Result<Void, Error>) -> Void)
    /// Re-reads the capture target (the `SCDisplay` snapshot the next `startCapture` filters on) after
    /// the display's mode changed. Never blocks: `completion` arrives later on the session queue,
    /// exactly once. `.failure(.permissionDenied)` when Screen Recording was revoked; any other
    /// failure (timeout, display not listed) keeps the old snapshot and has already been logged.
    func refreshCaptureTarget(completion: @escaping (Result<Void, BackendError>) -> Void)
    func currentWidthPoints() -> Int
    func displayBounds() -> CGRect
    /// The Mac's main display bounds (`CGDisplayBounds(CGMainDisplayID())`, read-only), for the placement hint.
    func mainDisplayBounds() -> CGRect
    func destroyDisplay()
}

/// One accepted TCP connection on the video socket.
public protocol PhoneConnection: AnyObject {
    func send(_ data: Data)
    func close()
}

/// Receives the helper → main event stream (stdout JSON lines in `main.swift`).
public protocol HelperEventSink: AnyObject {
    func emit(_ event: HelperEvent)
}

public typealias ConnectionID = Int

/// Pure orchestration of one display session (Contracts C/D/E): auth, deadlines, watchdog,
/// flow control and the capture lifecycle. Talks to the system only through `DisplayBackend`,
/// `PhoneConnection` and `HelperEventSink`; time comes from the injected `now`.
///
/// Not thread-safe: every call (including backend completions and encoder callbacks) must be
/// serialized onto one queue by the caller.
public final class SessionController {
    // Contract E constants.
    public static let authFirstFrameTimeout: TimeInterval = 3.0       // AUTH_FIRST_FRAME_MS
    public static let capturableTimeout: TimeInterval = 5.0           // SC_APPEAR_TIMEOUT_MS
    public static let connectDeadline: TimeInterval = 10.0            // CONNECT_DEADLINE_MS
    public static let keepaliveInterval: TimeInterval = 1.0           // KEEPALIVE_INTERVAL_MS
    public static let statsInterval: TimeInterval = 5.0               // STATS_INTERVAL_MS
    public static let watchdogActive: TimeInterval = 2.0              // WATCHDOG_ACTIVE_MS
    public static let watchdogPaused: TimeInterval = 10.0             // WATCHDOG_PAUSED_MS
    public static let ackStall: TimeInterval = 1.0                    // ACK_STALL_MS
    public static let maxUnacked: UInt64 = 2                          // MAX_UNACKED
    /// Accepted surface dimensions (Contract A `display.start` bounds), for hello and resize.
    public static let surfaceRange = 320...8192
    /// A `resize` is applied this long after the LAST one (checked in `tick()`), so a phone turning
    /// through several orientations costs one renegotiation.                // RESIZE_COALESCE_MS
    public static let resizeCoalesce: TimeInterval = 0.3
    /// After one of our own mode activations lands, the reconfiguration notifications it caused
    /// (the backend delivers them ~0.1 s later) only report bounds: capture already started on the
    /// new mode, so restarting it again would be a second blink.
    /// It also absorbs the restart for a user scale change made within 0.5 s of our own activation
    /// (bounds still update; the stale capture target is refreshed at the next restart).
    public static let ownReconfigurationQuiet: TimeInterval = 0.5
    /// Re-reads of the capture target allowed per restart after the first, when the display keeps
    /// reconfiguring while it is read; then capture starts with the latest snapshot.
    public static let maxExtraTargetRefreshes = 2
    /// The whole start (`begin()` → `ready` or an end) stays within this, so it fits well inside the
    /// phone's 12 s DISPLAY_REPLY_TIMEOUT_MS with helper spawn and `adb reverse` on top. Each identity's
    /// activation is at most 3 s (`ActivationPoll`); the capturable wait gets what is left (at most
    /// `capturableTimeout`, at least `minCapturableTimeout`).
    public static let startBudget: TimeInterval = 8.0
    public static let minCapturableTimeout: TimeInterval = 1.0
    /// The fresh identity is tried only when the primary and spare gave up within this (typically
    /// ~2.3 s: 1 s offline give-up each plus destroy/create), so its activation (≤ 3 s) and mirror check
    /// (`MirrorSettlePoll.window`, 0.25 s) still leave the capturable wait at least
    /// `startBudget - 6.75` s (≥ `minCapturableTimeout`). An identity dropped as mirrored takes its
    /// activation plus at most the settle window, and counts toward this cutoff like an offline one.
    public static let freshIdentityCutoff: TimeInterval = 3.5
    /// While a phone is connected, Accessibility (PostEvent) is re-checked this often (in `tick()`), so a
    /// grant turns touch on mid-session and a revoke turns it off; the phone hears `inputState`.
    public static let inputRecheckInterval: TimeInterval = 2.0

    public private(set) var endedReason: EndReason?
    /// Authenticated `input` messages, only while PostEvent access is granted (at hello, then re-checked
    /// every `inputRecheckInterval`). Never called
    /// once the session has started ending.
    public var onInput: ((InputEvent) -> Void)?
    /// Invoked exactly once per session, from every end path, BEFORE the display is destroyed: the
    /// owner releases any held mouse button while the display (and its coordinates) still exist.
    public var onTeardown: (() -> Void)?
    /// The display's global bounds (points) changed: after the hello implicit resize, after every
    /// applied resize and from `displayReconfigured()`. Input mapping must follow it.
    public var onBoundsChanged: ((CGRect) -> Void)?
    /// A `resize` is being applied (before the mode changes and before `onBoundsChanged`): the owner
    /// releases any held mouse button so a drag cannot jump across the re-laid-out display.
    public var onResizeApplied: (() -> Void)?
    /// Debug diagnostics that are not Contract C `log` events (stderr in production).
    public var debugLog: (String) -> Void = { Stderr.diag($0) }

    private let start: StartCommand
    private let backend: DisplayBackend
    private let sink: HelperEventSink
    private let now: () -> TimeInterval

    private final class Conn {
        let connection: PhoneConnection
        var decoder = FrameDecoder(maxLength: Framing.maxPreAuthLength)
        let acceptedAt: TimeInterval
        init(_ connection: PhoneConnection, acceptedAt: TimeInterval) {
            self.connection = connection
            self.acceptedAt = acceptedAt
        }
    }

    private var begun = false
    private var beganAt: TimeInterval = 0
    /// `ready` was emitted: from then on a display macOS switches off ends the session `display-offline`.
    private var readySent = false
    private var displayCreated = false
    private var displayId: UInt32 = 0
    /// An `.unknown` settle verdict was logged for the current display (once per display).
    private var loggedUnknownMirror = false
    private var deadline: ConnectDeadline?          // non-nil from `ready` until authenticated
    private var nextId: ConnectionID = 1
    private var pending: [ConnectionID: Conn] = [:]
    private var authedId: ConnectionID?
    private var authed: Conn?

    // Authenticated-session state.
    private var watchdog = KeepaliveWatchdog(now: 0)
    private var flow = FlowControl(maxUnacked: SessionController.maxUnacked, stallTimeout: SessionController.ackStall)
    private var paused = false
    private var capturing = false
    /// A mode activation (implicit resize) is in flight; capture (re)starts when it completes.
    private var activating = false
    /// Bumped per activation request so only the latest completion acts.
    private var activationGeneration = 0
    private var surface = (w: 0, h: 0)
    private var decoderMax = (w: 0, h: 0)
    private var showsCursor = false
    /// `preflightPostEvent()` at hello, then every `inputRecheckInterval`; `input` is dropped while false.
    private var inputEnabled = false
    private var lastInputCheckAt: TimeInterval = 0
    private var lastKeepaliveAt: TimeInterval = 0
    private var statsWindowStart: TimeInterval = 0
    private var framesInWindow = 0
    private var bytesInWindow = 0
    private var phoneStats = PhoneStats(rendered: 0, dropped: 0, decodeMsAvg: 0)
    /// The latest `resize` not yet applied, and when it arrived (coalescing window anchor).
    private var pendingResize: (w: Int, h: Int)?
    private var lastResizeAt: TimeInterval = 0
    /// Until then, `displayReconfigured()` reports bounds without restarting capture.
    private var reconfigurationQuietUntil: TimeInterval = -.infinity
    /// The display's mode/geometry changed since the capture target was last read: the next capture
    /// (re)start refreshes it first.
    private var captureTargetStale = false
    private var loggedTypes: Set<String> = []
    /// This start created the fresh identity (reported on `ended`, Ruling P0-7). Set once it exists,
    /// so a fresh identity that could not even be created does not count.
    private var freshTried = false
    /// This start dropped an identity as mirrored (reported on `ready`, so main moves past the generation).
    private var mirroredSkipped = false

    public init(start: StartCommand, backend: DisplayBackend, sink: HelperEventSink,
                now: @escaping () -> TimeInterval) {
        self.start = start
        self.backend = backend
        self.sink = sink
        self.now = now
        self.surface = (start.surfaceW, start.surfaceH)
    }

    // MARK: - Lifecycle

    /// Call only after the video listener is bound. preflight → createDisplay → applyModes (async
    /// activation) → mirror check (`MirrorSettlePoll`) → waitUntilCapturable → `.ready` (the connect
    /// deadline starts here).
    ///
    /// When macOS keeps the primary identity switched off (`displayOffline` while awake) or restores a
    /// saved mirror set for it (Screen Mirroring › Entire Screen), the display is destroyed and recreated
    /// once with the spare identity (`DisplayIdentity`). When the spare is unusable too and main sent a `freshSerial` (Ruling P0-7: the phone's next identity generation,
    /// which macOS has no saved state for), it is recreated once more with that serial, unless the
    /// start already used `freshIdentityCutoff`. Whatever is still offline or mirrored ends `display-offline`.
    public func begin() {
        guard !begun, endedReason == nil else { return }
        begun = true
        beganAt = now()
        guard backend.preflightScreenRecording() else { return terminate(.permissionScreenRecording) }
        createAndActivate(.primary)
    }

    private enum Identity: String { case primary, spare, fresh }

    private func serial(for identity: Identity) -> UInt32 {
        switch identity {
        case .primary: return start.serialNum
        case .spare: return DisplayIdentity.spareSerial(for: start.serialNum)
        case .fresh: return start.freshSerial ?? start.serialNum
        }
    }

    /// The identity to try after `identity` came up switched off or mirrored while the Mac is awake, if any.
    private func nextIdentity(after identity: Identity, _ cause: Unusable) -> Identity? {
        switch identity {
        case .primary: return .spare
        case .spare:
            guard start.freshSerial != nil else { return nil }
            guard now() - beganAt <= Self.freshIdentityCutoff else {
                log("warn", "the spare display identity is \(cause.adjective) too, but there is no time left in this start "
                    + "for a fresh identity; the next start tries it")
                return nil
            }
            return .fresh
        case .fresh: return nil
        }
    }

    private static func hex(_ serial: UInt32) -> String { String(format: "0x%08x", serial) }

    private func createAndActivate(_ identity: Identity) {
        let w = start.surfaceW, h = start.surfaceH
        let serialNum = serial(for: identity)
        let startedAt = now()
        do {
            displayId = try backend.createDisplay(
                maxPixels: DisplayModes.descriptorMaxPixels(surfaceW: w, surfaceH: h),
                sizeInMillimeters: DisplayModes.sizeInMillimeters(surfaceW: w, surfaceH: h, dpi: start.dpi),
                serialNum: serialNum, vendorId: start.vendorId, productId: start.productId)
        } catch {
            log("error", "createDisplay failed (\(identity.rawValue) identity \(Self.hex(serialNum))): \(error)")
            return terminate(startFailureReason(.unsupported))
        }
        displayCreated = true
        loggedUnknownMirror = false
        if identity == .fresh { freshTried = true }
        backend.applyModes(DisplayModes.modes(surfaceW: w, surfaceH: h)) { [weak self] result in
            guard let self, self.endedReason == nil else { return }
            switch result {
            case .success:
                let ms = Int(((self.now() - startedAt) * 1000).rounded())
                self.settleMirror(identity, serialNum: serialNum, activationMs: ms, poll: MirrorSettlePoll())
            case .failure(let error):
                if error as? BackendError == .displayOffline {
                    return self.dropIdentity(identity, serialNum: serialNum, because: .switchedOff)
                }
                // Activation found a mirror before configuring anything, or failed on a display that is
                // mirrored (a mirror secondary may never get its HiDPI mode): dropped like offline.
                if case .displayMirrored(let why)? = error as? BackendError {
                    return self.judgedMirrored(identity, serialNum: serialNum, by: "activation, before configuring", why)
                }
                if case .mirrored(let why) = self.backend.mirrorVerdict() {
                    return self.judgedMirrored(identity, serialNum: serialNum, by: "after a failed activation (\(error))", why)
                }
                self.log("error", "mode activation failed: \(error)")
                self.terminate(self.startFailureReason(.unsupported))
            }
        }
    }

    /// Why an identity that was created cannot be used for this start. Both are handled the same way:
    /// destroy it, try the next identity (`nextIdentity`), end `display-offline` when none is left (main
    /// then uses up the identity).
    private enum Unusable {
        /// Offline for 1 s during activation: macOS keeps it out of the desktop (independent output).
        case switchedOff
        /// macOS restored a saved mirror set for it ("Entire Screen"), so it mirrors instead of
        /// extending the desktop. The helper never un-mirrors: that would rewrite the user's saved
        /// display settings.
        case mirrored

        var adjective: String { self == .switchedOff ? "switched off" : "mirrored" }
    }

    /// After activation succeeded: check `MirrorSettlePoll.checks` times, `interval` apart (the saved
    /// set may land a little after activation), before waiting for capturability. A late check for a
    /// session that has ended meanwhile does nothing.
    /// A check CoreGraphics cannot answer yet (`.unknown`, F-M1) is no evidence of a mirror and counts as
    /// a clean one; the pre-ready check runs later still.
    private func settleMirror(_ identity: Identity, serialNum: UInt32, activationMs: Int, poll: MirrorSettlePoll) {
        var poll = poll
        let verdict = backend.mirrorVerdict()
        if verdict == .unknown, !loggedUnknownMirror {
            loggedUnknownMirror = true
            logUnknownMirror(serialNum: serialNum, by: "settle check \(poll.attempts + 1)", "counted as clean (logged once per display)")
        }
        switch poll.record(mirrored: verdict.isMirrored) {
        case .mirrored:
            guard case .mirrored(let why) = verdict else { return }
            judgedMirrored(identity, serialNum: serialNum, by: "settle check \(poll.attempts)", why)
        case .retry:
            backend.runLater(after: MirrorSettlePoll.interval) { [weak self] in
                guard let self, self.endedReason == nil, self.displayCreated else { return }
                self.settleMirror(identity, serialNum: serialNum, activationMs: activationMs, poll: poll)
            }
        case .clear:
            log("info", "using the \(identity.rawValue) display identity \(Self.hex(serialNum)) (modes active after \(activationMs) ms)")
            waitUntilCapturable(identity, serialNum: serialNum)
        }
    }

    /// Every mirror judgement logs, at `warn`, which check made it and exactly which read-only queries
    /// fired (F-M1), then drops the identity.
    private func judgedMirrored(_ identity: Identity, serialNum: UInt32, by check: String, _ why: String) {
        logMirrorJudgement(serialNum: serialNum, by: check, why)
        dropIdentity(identity, serialNum: serialNum, because: .mirrored)
    }

    /// `.unknown` (F-M1): CoreGraphics in this process does not list the display yet, so the check has
    /// no answer; it is never a mirror.
    private func logUnknownMirror(serialNum: UInt32, by check: String, _ outcome: String) {
        log("info", "mirror check (\(check)) cannot tell yet for identity \(Self.hex(serialNum)) (display "
            + "\(Self.hex(displayId))): CoreGraphics in this process does not list it yet; \(outcome)")
    }

    private func logMirrorJudgement(serialNum: UInt32, by check: String, _ why: String) {
        log("warn", "mirror check (\(check)) judged identity \(Self.hex(serialNum)) (display \(Self.hex(displayId))) "
            + "mirrored: \(why)")
    }

    private func dropIdentity(_ identity: Identity, serialNum: UInt32, because cause: Unusable) {
        // Asleep: a second display would only leave a second ghost (F2); sleep explains it.
        if !backend.mainDisplayAsleep(), let next = nextIdentity(after: identity, cause) {
            let nextSerial = serial(for: next)
            switch cause {
            case .switchedOff:
                log("warn", "macOS keeps Desk Agent Phone switched off for identity \(Self.hex(serialNum)); "
                    + "retrying once with the \(next.rawValue) display identity \(Self.hex(nextSerial))")
            case .mirrored:
                log("warn", "macOS restored a saved mirror set (Screen Mirroring › Entire Screen) for identity "
                    + "\(Self.hex(serialNum)), so Desk Agent Phone would mirror instead of extending the desktop; "
                    + "dropping it and retrying once with the \(next.rawValue) display identity \(Self.hex(nextSerial))")
                mirroredSkipped = true
            }
            backend.destroyDisplay()
            displayCreated = false
            return createAndActivate(next)
        }
        switch cause {
        case .switchedOff:
            log("error", "mode activation failed: the display stayed offline (macOS keeps Desk Agent Phone out of the desktop)")
        case .mirrored:
            log("error", "Desk Agent Phone came up mirrored (a saved macOS mirror set) for identity \(Self.hex(serialNum)) "
                + "and no other display identity is left to try")
        }
        terminate(startFailureReason(.displayOffline))
    }

    /// The last mirror check is made right before `ready`, for a saved set that landed after the settle
    /// window. While the start is still within `freshIdentityCutoff` the identity is dropped as usual;
    /// later there is no time left for another identity, so it streams mirrored (as a mid-session mirror
    /// would) with a warning.
    private func waitUntilCapturable(_ identity: Identity, serialNum: UInt32) {
        let left = Self.startBudget - (now() - beganAt)
        let timeout = min(Self.capturableTimeout, max(Self.minCapturableTimeout, left))
        backend.waitUntilCapturable(displayId: displayId, timeout: timeout) { [weak self] result in
            guard let self, self.endedReason == nil else { return }
            switch result {
            case .success:
                let verdict = self.backend.mirrorVerdict()
                if verdict == .unknown {
                    self.logUnknownMirror(serialNum: serialNum, by: "before ready", "counted as clean")
                }
                if case .mirrored(let why) = verdict {
                    if self.now() - self.beganAt <= Self.freshIdentityCutoff {
                        return self.judgedMirrored(identity, serialNum: serialNum, by: "before ready", why)
                    }
                    self.logMirrorJudgement(serialNum: serialNum, by: "before ready", why)
                    self.log("warn", "Desk Agent Phone became mirrored (a saved macOS mirror set) for identity "
                        + "\(Self.hex(serialNum)) after the mirror check; no time is left in this start for another "
                        + "identity, so it streams mirrored")
                }
                self.deadline = ConnectDeadline(createdAt: self.now(), timeout: Self.connectDeadline)
                self.readySent = true
                self.sink.emit(.ready(displayId: self.displayId, port: self.start.port, serialNum: serialNum,
                                      mirroredSkipped: self.mirroredSkipped,
                                      postEventMissing: !self.backend.preflightPostEvent()))
            case .failure(let error):
                self.terminate(Self.endReason(for: error))
            }
        }
    }

    /// A display that could not be created or activated while the Mac's main display sleeps is
    /// explained by the sleep (WindowServer defers display teardown then, leaving a same-serial
    /// display registered); otherwise `reason`. Asked only on failure, so sleep never blocks a start.
    private func startFailureReason(_ reason: EndReason) -> EndReason {
        backend.mainDisplayAsleep() ? .macAsleep : reason
    }

    /// Idempotent: sends `end{reason}` to an authenticated phone, closes connections, stops capture,
    /// destroys the display and emits `.ended(reason)`.
    public func stop(_ reason: EndReason) { terminate(reason) }

    /// Asynchronous capture/encoder failure (`CaptureEncoder.onError`): same mapping as start failures.
    public func captureError(_ error: Error) {
        guard endedReason == nil else { return }
        log("error", "capture error: \(error)")
        // macOS switching the display off (Control Center) stops the stream first; name the real cause.
        // Revoked Screen Recording keeps its own reason.
        let reason = Self.endReason(for: error)
        if reason == .captureFailed, endIfSwitchedOff() { return }
        terminate(reason)
    }

    /// After `ready`, a display macOS took out of the desktop ends the session `display-offline`, or
    /// `mac-asleep` while the Mac's main display sleeps (as at start: sleep/lock explains it, and main
    /// uses up the identity on `display-offline`). Returns whether it ended. Before `ready`,
    /// ActivationPoll owns the offline state (it escalates).
    private func endIfSwitchedOff() -> Bool {
        guard readySent, displayCreated, !backend.displayIsOnline() else { return false }
        if backend.mainDisplayAsleep() {
            log("info", "Desk Agent Phone went offline while the Mac's display sleeps; ending the session")
            terminate(.macAsleep)
            return true
        }
        log("warn", "macOS switched off Desk Agent Phone during the session (it left the desktop)")
        terminate(.displayOffline)
        return true
    }

    /// BackendError → Contract C `ended` reason. Anything else is a capture failure.
    public static func endReason(for error: Error) -> EndReason {
        switch error as? BackendError {
        case .unsupported: return .unsupported
        case .displayOffline: return .displayOffline
        // Handled where it can occur (start: dropped like offline; after ready: the mode is kept).
        case .displayMirrored: return .unsupported
        case .captureUnavailable: return .captureUnavailable
        case .permissionDenied: return .permissionScreenRecording
        case .captureFailed, nil: return .captureFailed
        }
    }

    /// The single end path: every way a session ends goes through here.
    private func terminate(_ reason: EndReason) {
        guard endedReason == nil else { return }
        endedReason = reason
        deadline = nil
        // Before the display goes away (and before any later input can arrive: `endedReason` is set).
        onTeardown?()
        if let authed {
            send(.end(reason: reason.rawValue), to: authed)
            authed.connection.close()
        }
        authed = nil
        authedId = nil
        for conn in pending.values { conn.connection.close() }
        pending.removeAll()
        if capturing {
            backend.stopCapture()
            capturing = false
        }
        if displayCreated {
            backend.destroyDisplay()
            displayCreated = false
        }
        sink.emit(.ended(reason, freshTried: freshTried))
    }

    // MARK: - Connections

    public func accept(_ connection: PhoneConnection) -> ConnectionID {
        let id = nextId
        nextId += 1
        guard endedReason == nil, deadline != nil || authed != nil else {
            // Before `ready` (or after the end) nobody may connect.
            connection.close()
            return id
        }
        guard authed == nil else {
            log("warn", "second connection rejected: a phone is already connected")
            connection.close()
            return id
        }
        pending[id] = Conn(connection, acceptedAt: now())
        return id
    }

    public func closed(_ id: ConnectionID) {
        guard endedReason == nil else { return }
        if id == authedId {
            authed = nil      // already closed: don't send `end` into it
            authedId = nil
            terminate(.watchdog)
        } else {
            pending[id] = nil
        }
    }

    public func receive(_ bytes: Data, on id: ConnectionID) {
        guard endedReason == nil else { return }
        if id == authedId, let conn = authed {
            let frames: [DecodedFrame]
            do { frames = try conn.decoder.append(bytes) } catch {
                // The decoder is not poisoned after a throw: the connection must go.
                log("warn", "framing error from phone: \(error)")
                return terminate(.protocolError)
            }
            for frame in frames {
                guard endedReason == nil else { return }
                handleAuthenticated(frame)
            }
        } else if let conn = pending[id] {
            let frames: [DecodedFrame]
            do { frames = try conn.decoder.append(bytes) } catch {
                return drop(id, "framing error before auth: \(error)")
            }
            guard let first = frames.first else { return }
            handleFirstFrame(first, conn: conn, id: id)
            // Frames that arrived in the same read as the hello.
            for frame in frames.dropFirst() {
                guard endedReason == nil, id == authedId else { return }
                handleAuthenticated(frame)
            }
        }
    }

    private func drop(_ id: ConnectionID, _ why: String) {
        log("warn", "connection closed: \(why)")
        pending[id]?.connection.close()
        pending[id] = nil
    }

    private func handleFirstFrame(_ frame: DecodedFrame, conn: Conn, id: ConnectionID) {
        guard case .json(let body) = frame,
              case .hello(let hello)? = try? PhoneMessage.decode(body) else {
            return drop(id, "first frame was not a hello")
        }
        switch AuthGate.verdict(hello, token: start.token, sessionId: start.sessionId) {
        case .rejected:
            drop(id, "hello rejected")
        case .versionMismatch:
            log("warn", "hello version \(hello.v) != \(AuthGate.protocolVersion)")
            send(.end(reason: EndReason.versionMismatch.rawValue), to: conn)
            conn.connection.close()
            pending[id] = nil
            terminate(.versionMismatch)
        case .accepted:
            guard Self.surfaceRange.contains(hello.surfaceW), Self.surfaceRange.contains(hello.surfaceH),
                  hello.maxW > 0, hello.maxH > 0 else {
                log("warn", "hello size out of range: \(hello.surfaceW)x\(hello.surfaceH) max \(hello.maxW)x\(hello.maxH)")
                send(.end(reason: EndReason.protocolError.rawValue), to: conn)
                conn.connection.close()
                pending[id] = nil
                return terminate(.protocolError)
            }
            authenticate(conn, id: id, hello: hello)
        }
    }

    private func authenticate(_ conn: Conn, id: ConnectionID, hello: Hello) {
        pending[id] = nil
        for other in pending.values { other.connection.close() }
        pending.removeAll()
        conn.decoder.setMaxLength(Framing.maxPhoneFrameLength)
        authed = conn
        authedId = id
        deadline = nil
        let t = now()
        watchdog = KeepaliveWatchdog(activeTimeout: Self.watchdogActive, pausedTimeout: Self.watchdogPaused, now: t)
        lastKeepaliveAt = t
        statsWindowStart = t
        decoderMax = (hello.maxW, hello.maxH)
        showsCursor = hello.trackpad   // initial captured-cursor visibility (applied by startCapture)
        inputEnabled = backend.preflightPostEvent()
        lastInputCheckAt = t

        sink.emit(.connected)
        let side = DisplayArrangement.side(of: backend.displayBounds(), main: backend.mainDisplayBounds())
        send(.helloAck(inputEnabled: inputEnabled, side: side?.rawValue), to: conn)

        var modes: [ModeSpec]?
        if hello.surfaceW != start.surfaceW || hello.surfaceH != start.surfaceH {
            // Implicit resize (no coalescing). Divisor source: the mode macOS (or the user) has active
            // now, relative to the size the display was created for.
            let divisor = DisplayModes.nearestDivisor(currentWidthPoints: backend.currentWidthPoints(),
                                                      surfaceW: start.surfaceW)
            modes = DisplayModes.modes(surfaceW: hello.surfaceW, surfaceH: hello.surfaceH, preferredDivisor: divisor)
        }
        restartCapture(surfaceW: hello.surfaceW, surfaceH: hello.surfaceH, modes: modes)
    }

    // MARK: - Messages from the authenticated phone

    private func handleAuthenticated(_ frame: DecodedFrame) {
        guard case .json(let body) = frame else {
            log("warn", "phone sent a VIDEO frame")
            return terminate(.protocolError)
        }
        let message: PhoneMessage
        do { message = try PhoneMessage.decode(body) } catch {
            log("warn", "invalid message from phone")
            return terminate(.protocolError)
        }
        let t = now()
        watchdog.heard(at: t)   // any valid frame feeds the watchdog

        switch message {
        case .keepalive:
            break
        case .ack(let seq):
            if flow.ack(seq, at: t) { backend.unblocked() }
        case .requestIdr:
            flow.reset()
            backend.forceKeyframe()
        case .pause:
            guard !paused else { return }
            paused = true
            watchdog.setPaused(true, at: t)
            if capturing {
                backend.stopCapture()
                capturing = false
            }
            sink.emit(.paused)
        case .resume:
            guard paused else { return }
            paused = false
            watchdog.setPaused(false, at: t)
            restartCapture(surfaceW: surface.w, surfaceH: surface.h, modes: nil)
            if endedReason == nil { sink.emit(.resumed) }
        case .stats(let s):
            phoneStats = s
        case .bye:
            terminate(.phoneBye)
        case .hello:
            logOnce("hello", level: "warn", "duplicate hello ignored")
        case .setTrackpad(let on):
            showsCursor = on   // kept for every later capture (re)start
            backend.setShowsCursor(on)
        case .input(let event):
            // Never log per event (volume); once is enough to explain a dead touch screen.
            guard inputEnabled else {
                return logOnce("input-disabled", level: "warn", "input dropped: PostEvent access is missing")
            }
            onInput?(event)
        case .resize(let w, let h, _):
            guard Self.surfaceRange.contains(w), Self.surfaceRange.contains(h) else {
                return debugLog("resize dropped: \(w)x\(h) is outside \(Self.surfaceRange)")
            }
            // Coalesced: only the latest is applied, `resizeCoalesce` after it (in `tick()`).
            pendingResize = (w, h)
            lastResizeAt = t
        case .unknown(let type):
            logOnce(type, level: "warn", "unknown message type ignored: \(type)")
        }
    }

    // MARK: - Capture

    /// The one capture (re)start sequence: stop → [applyModes, asynchronously] → start at the stream
    /// size → reset the flow-control window → force an IDR. Failures end the session via the
    /// BackendError mapping, except a failed rotation activation (`revertTo` set): the old mode is
    /// still active, so the session keeps it and restarts capture at the old size (see below).
    /// While an activation is in flight the session keeps running (keepalives,
    /// watchdog, stop) without capture; a pause meanwhile defers the start to `resume`.
    private func restartCapture(surfaceW: Int, surfaceH: Int, modes: [ModeSpec]?,
                                revertTo previous: (w: Int, h: Int)? = nil) {
        if capturing {
            backend.stopCapture()
            capturing = false
        }
        let before = surface
        surface = (surfaceW, surfaceH)
        if let modes {
            activationGeneration += 1
            let generation = activationGeneration
            activating = true
            backend.applyModes(modes) { [weak self] result in
                guard let self, self.endedReason == nil, generation == self.activationGeneration else { return }
                switch result {
                case .success:
                    self.reconfigurationQuietUntil = self.now() + Self.ownReconfigurationQuiet
                    self.onBoundsChanged?(self.backend.displayBounds())
                    // Still `activating`: the refreshed capture target is part of the activation.
                    self.refreshTargetThenStart(generation: generation)
                case .failure(let error) where previous != nil:
                    // Rotation: the old mode is still active. Keep the session on it — old surface,
                    // capture at the old stream size from a refreshed target, with an IDR.
                    guard let previous else { return }
                    self.activating = false
                    self.log("warn", "resize to \(surfaceW)x\(surfaceH) failed (\(error)); keeping \(previous.w)x\(previous.h)")
                    self.captureTargetStale = true
                    self.onBoundsChanged?(self.backend.displayBounds())
                    self.restartCapture(surfaceW: previous.w, surfaceH: previous.h, modes: nil)
                case .failure(BackendError.displayMirrored):
                    // A mirrored display is never mode-switched (that would rewrite the user's saved
                    // mirror set): keep its current mode and stream it, as for any mid-session mirror.
                    self.activating = false
                    self.logOnce("mirrored-mode-kept", level: "info",
                                 "Desk Agent Phone is mirrored; keeping its current mode instead of switching to \(surfaceW)x\(surfaceH)")
                    self.captureTargetStale = true
                    self.onBoundsChanged?(self.backend.displayBounds())
                    self.restartCapture(surfaceW: before.w, surfaceH: before.h, modes: nil)
                case .failure(let error):
                    self.activating = false
                    self.log("error", "capture start failed: \(error)")
                    self.terminate(Self.endReason(for: error))
                }
            }
            return
        }
        // The in-flight activation (or refresh) starts capture when it lands.
        guard !activating else { return }
        if captureTargetStale {
            activationGeneration += 1
            activating = true
            return refreshTargetThenStart(generation: activationGeneration)
        }
        startCapture()
    }

    /// Async re-read of the capture target, then capture (unless paused: `resume` starts it). A late
    /// result for a superseded activation or an ended session is dropped by `generation`.
    /// A reconfiguration while it runs re-reads it (at most `maxExtraTargetRefreshes` more times).
    /// Screen Recording revoked → the session ends with the permission reason, no capture start.
    private func refreshTargetThenStart(generation: Int, extra: Int = 0) {
        captureTargetStale = false
        backend.refreshCaptureTarget { [weak self] result in
            guard let self, self.endedReason == nil, generation == self.activationGeneration else { return }
            if case .failure(.permissionDenied) = result {
                self.activating = false
                self.log("error", "Screen Recording access was revoked during the session")
                return self.terminate(.permissionScreenRecording)
            }
            if self.captureTargetStale {
                if extra < Self.maxExtraTargetRefreshes {
                    return self.refreshTargetThenStart(generation: generation, extra: extra + 1)
                }
                self.log("info", "display still reconfiguring after \(extra + 1) capture-target reads; starting with the latest snapshot")
            }
            self.activating = false
            if !self.paused { self.startCapture() }
        }
    }

    /// The display was reconfigured (the user picked another scale in Displays, or moved it in the
    /// arrangement, which moves its origin). Call on the session queue. Always reports the new bounds;
    /// a running capture restarts at the same stream size with an IDR. Paused, mid-activation (that
    /// completion starts capture), right after our own activation landed (the notification is its
    /// echo; capture already started on the new mode) or before hello: bounds only.
    ///
    /// A mirror set after `ready` (the user picked Screen Mirroring › Entire Screen) is a deliberate,
    /// reversible choice: it is logged once at info and the stream continues (it stays online, so it
    /// never ends the session nor uses up the identity). If macOS restores it at the next start, that
    /// start drops the identity (`settleMirror`).
    public func displayReconfigured() {
        guard endedReason == nil, displayCreated else { return }
        if endIfSwitchedOff() { return }
        if readySent, case .mirrored(let why) = backend.mirrorVerdict() {
            logOnce("mirrored-mid-session", level: "info",
                    "Desk Agent Phone is now in a macOS mirror set (Screen Mirroring › Entire Screen); keeping the stream (\(why))")
        }
        onBoundsChanged?(backend.displayBounds())
        captureTargetStale = true
        guard capturing, now() >= reconfigurationQuietUntil else { return }
        restartCapture(surfaceW: surface.w, surfaceH: surface.h, modes: nil)
    }

    /// Rotation renegotiation (Contract D `resize`): new modes at the user's current scale, then the
    /// usual restart (stop → applyModes, async → bounds → start at the new stream size → window reset →
    /// IDR; the encoder's next parameter sets go out as `streamConfig` + config frame). `seq` continues.
    private func applyResize(w: Int, h: Int) {
        guard (w, h) != surface else {
            return debugLog("resize to the current size \(w)x\(h) ignored")
        }
        // Divisor source: the mode active now, relative to the surface it was made for.
        let divisor = DisplayModes.nearestDivisor(currentWidthPoints: backend.currentWidthPoints(), surfaceW: surface.w)
        log("info", "resize \(surface.w)x\(surface.h) → \(w)x\(h) (divisor \(divisor))")
        onResizeApplied?()   // release a held button before the geometry changes
        flow.reset()
        restartCapture(surfaceW: w, surfaceH: h,
                       modes: DisplayModes.modes(surfaceW: w, surfaceH: h, preferredDivisor: divisor),
                       revertTo: surface)
    }

    private func startCapture() {
        do {
            let size = StreamSizing.streamSize(surfaceW: surface.w, surfaceH: surface.h,
                                               maxW: decoderMax.w, maxH: decoderMax.h)
            try backend.startCapture(width: size.w, height: size.h, showsCursor: showsCursor)
        } catch {
            log("error", "capture start failed: \(error)")
            return terminate(Self.endReason(for: error))
        }
        capturing = true
        flow.reset()
        backend.forceKeyframe()
    }

    // MARK: - Encoder side

    public func shouldEncodeNextFrame() -> Bool {
        endedReason == nil && authed != nil && !paused && flow.canSend
    }

    public func encoded(annexB: Data, keyframe: Bool) {
        guard endedReason == nil, let conn = authed, !paused else { return }
        let seq = flow.nextSeq(sentAt: now())
        conn.connection.send(Framing.video(flags: keyframe ? .keyframe : [], seq: seq, payload: annexB))
        framesInWindow += 1
        bytesInWindow += annexB.count
    }

    /// `streamConfig`, then the config VIDEO frame (seq 0, never acked), then a cleared window.
    public func parameterSets(annexB: Data, width: Int, height: Int) {
        guard endedReason == nil, let conn = authed else { return }
        send(.streamConfig(w: width, h: height), to: conn)
        conn.connection.send(Framing.video(flags: .config, seq: 0, payload: annexB))
        flow.reset()
    }

    // MARK: - Timers

    /// Driven every 250 ms.
    public func tick() {
        guard endedReason == nil else { return }
        let t = now()

        for (id, conn) in pending where t - conn.acceptedAt > Self.authFirstFrameTimeout {
            drop(id, "no hello within \(Self.authFirstFrameTimeout) s")
        }
        if let deadline, deadline.isExpired(at: t) {
            return terminate(.connectTimeout)
        }
        guard let conn = authed else { return }
        if watchdog.isExpired(at: t) {
            return terminate(.watchdog)
        }
        // Never while a mode activation is in flight: the resize waits for it (and stays coalesced).
        if let resize = pendingResize, !activating, t - lastResizeAt >= Self.resizeCoalesce {
            pendingResize = nil
            applyResize(w: resize.w, h: resize.h)
            guard endedReason == nil else { return }
        }
        if t - lastInputCheckAt >= Self.inputRecheckInterval {
            lastInputCheckAt = t
            recheckInputAccess(conn)
        }
        if flow.isStalled(at: t) {
            log("warn", "ack stall: \(flow.lastSent - flow.acked) unacked for > \(Self.ackStall) s; resetting window with IDR")
            flow.reset()
            backend.forceKeyframe()
        }
        if t - lastKeepaliveAt >= Self.keepaliveInterval {
            lastKeepaliveAt = t
            send(.keepalive, to: conn)
        }
        if t - statsWindowStart >= Self.statsInterval {
            emitStats(at: t)
        }
    }

    /// Accessibility (PostEvent) changed since the last check: input follows it and the phone is told
    /// (`inputState`, additive). Nothing is sent while it is unchanged.
    private func recheckInputAccess(_ conn: Conn) {
        let granted = backend.preflightPostEvent()
        guard granted != inputEnabled else { return }
        inputEnabled = granted
        if granted {
            loggedTypes.remove("input-disabled")   // a later revoke explains itself again
            log("info", "Accessibility (PostEvent) is granted now: touch input is on")
        } else {
            log("warn", "Accessibility (PostEvent) was revoked: touch input is off")
        }
        send(.inputState(inputEnabled: granted), to: conn)
    }

    private func emitStats(at t: TimeInterval) {
        let elapsed = max(t - statsWindowStart, 0.001)
        let latency = flow.latencyPercentiles()
        sink.emit(.stats(StatsEvent(
            fps: Int((Double(framesInWindow) / elapsed).rounded()),
            kbps: Int((Double(bytesInWindow) * 8 / 1000 / elapsed).rounded()),
            unacked: Int(flow.lastSent - flow.acked),
            ackP50Ms: latency.p50, ackP95Ms: latency.p95,
            phoneRendered: phoneStats.rendered, phoneDropped: phoneStats.dropped)))
        statsWindowStart = t
        framesInWindow = 0
        bytesInWindow = 0
    }

    // MARK: - Helpers

    private func send(_ message: HelperMessage, to conn: Conn) {
        guard let data = try? Framing.json(message) else {
            return log("error", "failed to encode \(message)")
        }
        conn.connection.send(data)
    }

    private func log(_ level: String, _ message: String) {
        sink.emit(.log(level: level, message: message))
    }

    private func logOnce(_ key: String, level: String, _ message: String) {
        guard loggedTypes.insert(key).inserted else { return }
        log(level, message)
    }
}
