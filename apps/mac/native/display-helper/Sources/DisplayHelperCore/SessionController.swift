import CoreGraphics
import Foundation

/// The system side of a session: virtual display + capture/encode. Implemented over
/// `VirtualDisplayController` + `CaptureEncoder` in DisplayHelperSystem (Task 1.7).
public protocol DisplayBackend: AnyObject {
    func preflightScreenRecording() -> Bool
    func preflightPostEvent() -> Bool
    func createDisplay(maxPixels: Int, sizeInMillimeters: CGSize, modes: [ModeSpec], serialNum: UInt32,
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
    func applyModes(_ modes: [ModeSpec]) throws
    func currentWidthPoints() -> Int
    func displayBounds() -> CGRect
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

    public private(set) var endedReason: EndReason?
    /// Wired in Task 4.3. Phase 1 ignores `input` messages and never invokes this.
    public var onInput: ((InputEvent) -> Void)?
    /// Wired in Task 4.3. Phase 1 ignores `setTrackpad` messages and never invokes this.
    public var onTrackpadChanged: ((Bool) -> Void)?

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
    private var displayCreated = false
    private var displayId: UInt32 = 0
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
    private var surface = (w: 0, h: 0)
    private var decoderMax = (w: 0, h: 0)
    private var showsCursor = false
    private var lastKeepaliveAt: TimeInterval = 0
    private var statsWindowStart: TimeInterval = 0
    private var framesInWindow = 0
    private var bytesInWindow = 0
    private var phoneStats = PhoneStats(rendered: 0, dropped: 0, decodeMsAvg: 0)
    private var loggedTypes: Set<String> = []

    public init(start: StartCommand, backend: DisplayBackend, sink: HelperEventSink,
                now: @escaping () -> TimeInterval) {
        self.start = start
        self.backend = backend
        self.sink = sink
        self.now = now
        self.surface = (start.surfaceW, start.surfaceH)
    }

    // MARK: - Lifecycle

    /// Call only after the video listener is bound. preflight → createDisplay → waitUntilCapturable
    /// → `.ready` (the connect deadline starts here).
    public func begin() {
        guard !begun, endedReason == nil else { return }
        begun = true
        guard backend.preflightScreenRecording() else { return terminate(.permissionScreenRecording) }
        let w = start.surfaceW, h = start.surfaceH
        do {
            displayId = try backend.createDisplay(
                maxPixels: DisplayModes.descriptorMaxPixels(surfaceW: w, surfaceH: h),
                sizeInMillimeters: DisplayModes.sizeInMillimeters(surfaceW: w, surfaceH: h, dpi: start.dpi),
                modes: DisplayModes.modes(surfaceW: w, surfaceH: h),
                serialNum: start.serialNum, vendorId: start.vendorId, productId: start.productId)
        } catch {
            log("error", "createDisplay failed: \(error)")
            return terminate(.unsupported)
        }
        displayCreated = true
        backend.waitUntilCapturable(displayId: displayId, timeout: Self.capturableTimeout) { [weak self] result in
            guard let self, self.endedReason == nil else { return }
            switch result {
            case .success:
                self.deadline = ConnectDeadline(createdAt: self.now(), timeout: Self.connectDeadline)
                self.sink.emit(.ready(displayId: self.displayId, port: self.start.port))
            case .failure(let error):
                self.terminate(Self.endReason(for: error))
            }
        }
    }

    /// Idempotent: sends `end{reason}` to an authenticated phone, closes connections, stops capture,
    /// destroys the display and emits `.ended(reason)`.
    public func stop(_ reason: EndReason) { terminate(reason) }

    /// Asynchronous capture/encoder failure (`CaptureEncoder.onError`): same mapping as start failures.
    public func captureError(_ error: Error) {
        guard endedReason == nil else { return }
        log("error", "capture error: \(error)")
        terminate(Self.endReason(for: error))
    }

    /// BackendError → Contract C `ended` reason. Anything else is a capture failure.
    public static func endReason(for error: Error) -> EndReason {
        switch error as? BackendError {
        case .unsupported: return .unsupported
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
        sink.emit(.ended(reason))
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
        showsCursor = hello.trackpad

        sink.emit(.connected)
        send(.helloAck(inputEnabled: backend.preflightPostEvent()), to: conn)

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
        if case .resize(let w, let h, _) = message,
           !(Self.surfaceRange.contains(w) && Self.surfaceRange.contains(h)) {
            log("warn", "resize out of range: \(w)x\(h)")
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
        case .resize, .setTrackpad, .input:
            // Phase 1: no handler until Tasks 4.3 / 4.5.
            let name: String
            switch message {
            case .resize: name = "resize"
            case .setTrackpad: name = "setTrackpad"
            default: name = "input"
            }
            logOnce(name, level: "info", "\(name) ignored (not supported yet)")
        case .unknown(let type):
            logOnce(type, level: "warn", "unknown message type ignored: \(type)")
        }
    }

    // MARK: - Capture

    /// The one capture (re)start sequence: stop → [applyModes] → start at the stream size →
    /// reset the flow-control window → force an IDR. Failures end the session via the BackendError mapping.
    private func restartCapture(surfaceW: Int, surfaceH: Int, modes: [ModeSpec]?) {
        if capturing {
            backend.stopCapture()
            capturing = false
        }
        do {
            if let modes { try backend.applyModes(modes) }
            surface = (surfaceW, surfaceH)
            let size = StreamSizing.streamSize(surfaceW: surfaceW, surfaceH: surfaceH,
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
