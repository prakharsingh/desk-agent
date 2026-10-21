import CoreGraphics
import Foundation
import Testing
@testable import DisplayHelperCore

// MARK: - Fakes

final class FakeBackend: DisplayBackend {
    var screenRecording = true
    var postEvent = true
    var createError: Error?
    var startError: Error?
    var applyError: Error?
    var widthPoints = 936   // 2340 / 2.5 — the 6T at the default preferred divisor

    var createCalls = 0
    var createArgs: (maxPixels: Int, size: CGSize)?
    var destroyCalls = 0
    var startCalls: [(w: Int, h: Int, cursor: Bool)] = []
    var stopCaptureCalls = 0
    var forceKeyframeCalls = 0
    var unblockedCalls = 0
    var applied: [[ModeSpec]] = []
    /// When true, `applyModes` completions are held in `pendingApplies` (mode activation still in
    /// flight, as on the real backend) instead of completing synchronously.
    var deferApply = false
    var pendingApplies: [(Result<Void, Error>) -> Void] = []
    /// Completes the oldest held activation.
    func completeApply(_ result: Result<Void, Error> = .success(())) {
        pendingApplies.removeFirst()(result)
    }
    var cursorCalls: [Bool] = []
    /// Ordered record of the calls that matter for sequencing assertions.
    var log: [String] = []
    var waitTimeout: TimeInterval?
    var waitCompletion: ((Result<Void, BackendError>) -> Void)?

    func preflightScreenRecording() -> Bool { screenRecording }
    func preflightPostEvent() -> Bool { postEvent }
    func createDisplay(maxPixels: Int, sizeInMillimeters: CGSize, serialNum: UInt32,
                       vendorId: UInt32, productId: UInt32) throws -> UInt32 {
        createCalls += 1
        log.append("createDisplay")
        if let createError { throw createError }
        createArgs = (maxPixels, sizeInMillimeters)
        return 7
    }
    func waitUntilCapturable(displayId: UInt32, timeout: TimeInterval,
                             completion: @escaping (Result<Void, BackendError>) -> Void) {
        log.append("waitUntilCapturable")
        waitTimeout = timeout
        waitCompletion = completion
    }
    func startCapture(width: Int, height: Int, showsCursor: Bool) throws {
        log.append("startCapture")
        if let startError { throw startError }
        startCalls.append((width, height, showsCursor))
    }
    func stopCapture() { stopCaptureCalls += 1; log.append("stopCapture") }
    func forceKeyframe() { forceKeyframeCalls += 1; log.append("forceKeyframe") }
    func unblocked() { unblockedCalls += 1 }
    func setShowsCursor(_ on: Bool) { cursorCalls.append(on) }
    func applyModes(_ modes: [ModeSpec], completion: @escaping (Result<Void, Error>) -> Void) {
        log.append("applyModes")
        applied.append(modes)
        if deferApply { return pendingApplies.append(completion) }
        if let applyError { return completion(.failure(applyError)) }
        completion(.success(()))
    }
    func currentWidthPoints() -> Int { widthPoints }
    func displayBounds() -> CGRect { CGRect(x: 0, y: 0, width: widthPoints, height: 432) }
    func destroyDisplay() { destroyCalls += 1; log.append("destroyDisplay") }
}

final class FakeConnection: PhoneConnection {
    var sent: [Data] = []
    var closeCalls = 0
    var closed: Bool { closeCalls > 0 }
    /// Order of send/close, to assert "end before close".
    var log: [String] = []

    func send(_ data: Data) { sent.append(data); log.append("send") }
    func close() { closeCalls += 1; log.append("close") }

    var frames: [DecodedFrame] {
        var d = FrameDecoder(maxLength: Framing.maxFrameLength)
        return sent.flatMap { (try? d.append($0)) ?? [] }
    }
    var json: [[String: Any]] {
        frames.compactMap {
            guard case .json(let body) = $0 else { return nil }
            return (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
        }
    }
    var jsonTypes: [String] { json.compactMap { $0["t"] as? String } }
    var videoFrames: [(flags: VideoFlags, seq: UInt64, payload: Data)] {
        frames.compactMap {
            guard case .video(let f, let seq, let p) = $0 else { return nil }
            return (f, seq, p)
        }
    }
}

final class RecordingSink: HelperEventSink {
    var events: [HelperEvent] = []
    func emit(_ event: HelperEvent) { events.append(event) }
    var logs: [HelperEvent] { events.filter { if case .log = $0 { return true } else { return false } } }
    func logs(level: String) -> [String] {
        events.compactMap { if case .log(let l, let m) = $0, l == level { return m } else { return nil } }
    }
    var ended: [HelperEvent] { events.filter { if case .ended = $0 { return true } else { return false } } }
}

final class Clock { var t: TimeInterval = 100 }

// MARK: - Frame builders

func jsonFrame(_ s: String) -> Data {
    let body = Data(s.utf8)
    var out = Data()
    let len = UInt32(1 + body.count)
    out.append(contentsOf: [UInt8(len >> 24 & 0xff), UInt8(len >> 16 & 0xff), UInt8(len >> 8 & 0xff), UInt8(len & 0xff), 0x02])
    out.append(body)
    return out
}

func helloFrame(v: Int = 1, token: String = "tok", sessionId: String = "s1", w: Int = 2340, h: Int = 1080,
                orientation: String = "landscape", maxW: Int = 4096, maxH: Int = 4096, trackpad: Bool = false) -> Data {
    jsonFrame(#"{"t":"hello","v":\#(v),"token":"\#(token)","sessionId":"\#(sessionId)","surfaceW":\#(w),"surfaceH":\#(h),"orientation":"\#(orientation)","codecs":["h264"],"maxW":\#(maxW),"maxH":\#(maxH),"trackpad":\#(trackpad)}"#)
}

func ackFrame(_ seq: UInt64) -> Data { jsonFrame(#"{"t":"ack","seq":\#(seq)}"#) }

// MARK: - Harness

final class Harness {
    let clock = Clock()
    let backend = FakeBackend()
    let sink = RecordingSink()
    let start: StartCommand
    lazy var ctrl: SessionController = {
        let clock = self.clock
        return SessionController(start: start, backend: backend, sink: sink, now: { clock.t })
    }()

    init(w: Int = 2340, h: Int = 1080) {
        start = StartCommand(sessionId: "s1", token: "tok", port: 8788, surfaceW: w, surfaceH: h,
                             orientation: w >= h ? .landscape : .portrait, serialNum: 42,
                             vendorId: 0x3456, productId: 0x4D44, dpi: nil)
    }

    /// begin() + capturable → `.ready`.
    @discardableResult
    func ready() -> Harness {
        ctrl.begin()
        backend.waitCompletion?(.success(()))
        return self
    }

    func advance(_ dt: TimeInterval) { clock.t += dt }

    /// Accept a connection and send `frames` on it.
    @discardableResult
    func connect(_ frames: Data...) -> (FakeConnection, ConnectionID) {
        let c = FakeConnection()
        let id = ctrl.accept(c)
        for f in frames { ctrl.receive(f, on: id) }
        return (c, id)
    }

    /// Ready + authenticated phone.
    func authed(trackpad: Bool = false) -> (FakeConnection, ConnectionID) {
        ready()
        return connect(helloFrame(trackpad: trackpad))
    }

    func encode(_ n: Int, bytes: Int = 100) {
        for _ in 0..<n { ctrl.encoded(annexB: Data(repeating: 0xAB, count: bytes), keyframe: false) }
    }
}

// MARK: - Tests

@Suite struct SessionControllerTests {

    // MARK: begin()

    @Test func endsWithPermissionErrorBeforeCreatingDisplay() {
        let h = Harness()
        h.backend.screenRecording = false
        h.ctrl.begin()
        #expect(h.backend.createCalls == 0)
        #expect(h.backend.destroyCalls == 0)
        #expect(h.sink.events.last == .ended(.permissionScreenRecording))
        #expect(h.ctrl.endedReason == .permissionScreenRecording)
    }

    @Test func emitsReadyOnlyAfterDisplayIsCapturable() {
        let h = Harness()
        h.ctrl.begin()
        #expect(h.backend.createCalls == 1)
        #expect(h.backend.waitTimeout == 5.0)
        #expect(h.sink.events.isEmpty)
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.events == [.ready(displayId: 7, port: 8788)])
    }

    @Test func createDisplayUsesDescriptorSizingAndPreferredModesFirst() {
        let h = Harness()
        h.ctrl.begin()
        #expect(h.backend.createArgs?.maxPixels == 4680)
        #expect(h.backend.createArgs?.size == CGSize(width: 145, height: 67))
        #expect(h.backend.applied == [DisplayModes.modes(surfaceW: 2340, surfaceH: 1080)])
        #expect(h.backend.log == ["createDisplay", "applyModes", "waitUntilCapturable"])
    }

    // MARK: begin() — mode activation is asynchronous (I2)

    @Test func waitsForInitialModeActivationBeforeWaitingForCapturable() {
        let h = Harness()
        h.backend.deferApply = true
        h.ctrl.begin()
        #expect(h.backend.applied.count == 1)
        #expect(h.backend.waitTimeout == nil)
        #expect(h.sink.events.isEmpty)
        h.backend.completeApply()
        #expect(h.backend.waitTimeout == 5.0)
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.events == [.ready(displayId: 7, port: 8788)])
    }

    @Test func initialModeActivationFailureEndsUnsupportedAndDestroysTheDisplay() {
        let h = Harness()
        h.backend.deferApply = true
        h.ctrl.begin()
        h.backend.completeApply(.failure(BackendError.unsupported))
        #expect(h.sink.ended == [.ended(.unsupported)])
        #expect(!h.sink.events.contains(.ready(displayId: 7, port: 8788)))
        #expect(h.backend.destroyCalls == 1)
        #expect(h.backend.waitTimeout == nil)
    }

    @Test func stopDuringInitialActivationDestroysAndIgnoresTheLateResult() {
        let h = Harness()
        h.backend.deferApply = true
        h.ctrl.begin()
        h.ctrl.stop(.stopRequested)
        #expect(h.sink.events == [.ended(.stopRequested)])
        #expect(h.backend.destroyCalls == 1)
        h.backend.completeApply()
        #expect(h.backend.waitTimeout == nil)
        #expect(h.sink.events == [.ended(.stopRequested)])
    }

    @Test func createDisplayThrowEndsUnsupported() {
        let h = Harness()
        h.backend.createError = BackendError.unsupported
        h.ctrl.begin()
        #expect(h.sink.events.last == .ended(.unsupported))
        #expect(h.sink.ended.count == 1)
        #expect(!h.sink.events.contains(.ready(displayId: 7, port: 8788)))
        #expect(h.backend.destroyCalls == 0)
    }

    @Test func unsupportedWhenDisplayNeverAppears() {
        let h = Harness()
        h.ctrl.begin()
        h.backend.waitCompletion?(.failure(.unsupported))
        #expect(h.sink.events == [.ended(.unsupported)])
        #expect(h.backend.destroyCalls == 1)
    }

    @Test func captureUnavailableWhenOnlineButNotShareable() {
        let h = Harness()
        h.ctrl.begin()
        h.backend.waitCompletion?(.failure(.captureUnavailable))
        #expect(h.sink.events == [.ended(.captureUnavailable)])
        #expect(h.backend.destroyCalls == 1)
    }

    @Test func permissionDeniedWhileWaitingMapsToPermissionError() {
        let h = Harness()
        h.ctrl.begin()
        h.backend.waitCompletion?(.failure(.permissionDenied))
        #expect(h.sink.events == [.ended(.permissionScreenRecording)])
    }

    @Test func captureFailedWhileWaitingMapsToCaptureFailed() {
        let h = Harness()
        h.ctrl.begin()
        h.backend.waitCompletion?(.failure(.captureFailed("x")))
        #expect(h.sink.events == [.ended(.captureFailed)])
    }

    @Test func capturableAfterStopIsIgnored() {
        let h = Harness()
        h.ctrl.begin()
        h.ctrl.stop(.stopRequested)
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.events == [.ended(.stopRequested)])
    }

    // MARK: connections and auth

    @Test func connectionBeforeReadyIsClosed() {
        let h = Harness()
        h.ctrl.begin()
        let (c, _) = h.connect(helloFrame())
        #expect(c.closed)
        #expect(c.sent.isEmpty)
        #expect(h.backend.startCalls.isEmpty)
        #expect(h.ctrl.endedReason == nil)
    }

    @Test func rejectsBadTokenAndKeepsListening() {
        let h = Harness().ready()
        let (bad, _) = h.connect(helloFrame(token: "nope"))
        #expect(bad.closed)
        #expect(bad.sent.isEmpty)
        #expect(h.ctrl.endedReason == nil)
        let (good, _) = h.connect(helloFrame())
        #expect(!good.closed)
        #expect(h.sink.events.last == .connected)
    }

    @Test func wrongSessionIdIsRejectedEvenWithWrongVersion() {
        let h = Harness().ready()
        let (c, _) = h.connect(helloFrame(v: 2, sessionId: "other"))
        #expect(c.closed)
        #expect(c.sent.isEmpty)
        #expect(h.ctrl.endedReason == nil)
    }

    @Test func nonHelloFirstFrameClosesOnlyThatConnection() {
        let h = Harness().ready()
        let (c, _) = h.connect(jsonFrame(#"{"t":"keepalive"}"#))
        #expect(c.closed)
        #expect(h.ctrl.endedReason == nil)
    }

    @Test func framingErrorBeforeAuthClosesOnlyThatConnection() {
        let h = Harness().ready()
        let (c, _) = h.connect(Data([0, 0, 0x10, 0x01, 0x02]))   // len 4097 > pre-auth cap
        #expect(c.closed)
        #expect(h.ctrl.endedReason == nil)
    }

    @Test func closesConnectionThatSendsNothingFor3s() {
        let h = Harness().ready()
        let (c, _) = h.connect()
        h.advance(2.9)
        h.ctrl.tick()
        #expect(!c.closed)
        h.advance(0.11)
        h.ctrl.tick()
        #expect(c.closed)
        #expect(h.ctrl.endedReason == nil)
    }

    @Test func connectDeadlineDestroysDisplayAfter10s() {
        let h = Harness().ready()
        h.advance(9.9)
        h.ctrl.tick()
        #expect(h.ctrl.endedReason == nil)
        h.advance(0.11)
        h.ctrl.tick()
        #expect(h.sink.events.last == .ended(.connectTimeout))
        #expect(h.backend.destroyCalls == 1)
    }

    @Test func connectDeadlineIsAnchoredAtReadyNotBegin() {
        let h = Harness()
        h.ctrl.begin()
        h.advance(4)                       // waitUntilCapturable took 4 s
        h.backend.waitCompletion?(.success(()))
        h.advance(9)
        h.ctrl.tick()
        #expect(h.ctrl.endedReason == nil)
        h.advance(1.01)
        h.ctrl.tick()
        #expect(h.ctrl.endedReason == .connectTimeout)
    }

    @Test func validHelloStartsCaptureAndForcesIDR() {
        let h = Harness()
        let (c, _) = h.authed()
        #expect(h.backend.startCalls.count == 1)
        #expect(h.backend.startCalls.first?.w == 2340)
        #expect(h.backend.startCalls.first?.h == 1080)
        #expect(h.backend.startCalls.first?.cursor == false)
        #expect(h.backend.forceKeyframeCalls == 1)
        #expect(h.backend.applied.count == 1)   // only the initial modes from begin()
        #expect(c.jsonTypes == ["helloAck"])
        #expect(c.json.first?["inputEnabled"] as? Bool == true)
        #expect(h.sink.events == [.ready(displayId: 7, port: 8788), .connected])
        #expect(h.backend.log.suffix(2) == ["startCapture", "forceKeyframe"])
    }

    @Test func helloAckReportsInputDisabledWithoutPostEventAccess() {
        let h = Harness()
        h.backend.postEvent = false
        let (c, _) = h.authed()
        #expect(c.json.first?["inputEnabled"] as? Bool == false)
    }

    @Test func helloTrackpadShowsTheCursor() {
        let h = Harness()
        _ = h.authed(trackpad: true)
        #expect(h.backend.startCalls.first?.cursor == true)
    }

    @Test func helloStreamSizeRespectsDecoderMax() {
        let h = Harness().ready()
        h.connect(helloFrame(maxW: 1170, maxH: 1080))
        #expect(h.backend.startCalls.first?.w == 1170)
        #expect(h.backend.startCalls.first?.h == 540)
    }

    @Test func helloWithDifferentSizeIsAnImplicitResize() {
        let h = Harness().ready()
        // Divisor source: nearestDivisor(currentWidthPoints: 936, surfaceW: start.surfaceW 2340) == 2.5.
        h.connect(helloFrame(w: 1080, h: 2340, orientation: "portrait"))
        #expect(h.backend.applied.last == DisplayModes.modes(surfaceW: 1080, surfaceH: 2340, preferredDivisor: 2.5))
        #expect(h.backend.applied.count == 2)
        #expect(h.backend.startCalls.first?.w == 1080)
        #expect(h.backend.startCalls.first?.h == 2340)
        let order = h.backend.log.filter { ["applyModes", "startCapture", "forceKeyframe"].contains($0) }
        #expect(order == ["applyModes", "applyModes", "startCapture", "forceKeyframe"])   // begin(), then the resize
    }

    @Test func implicitResizeKeepsTheUsersCurrentDivisor() {
        let h = Harness().ready()
        h.backend.widthPoints = 1170   // macOS activated the 2.0 (pixel-exact) mode
        h.connect(helloFrame(w: 1080, h: 2340, orientation: "portrait"))
        #expect(h.backend.applied.last?.first == ModeSpec(widthPoints: 540, heightPoints: 1170))
    }

    @Test func implicitResizeFailureEndsTheSession() {
        let h = Harness().ready()
        h.backend.applyError = BackendError.captureFailed("mode")
        h.connect(helloFrame(w: 1080, h: 2340, orientation: "portrait"))
        #expect(h.ctrl.endedReason == .captureFailed)
        #expect(h.backend.startCalls.isEmpty)
    }

    // MARK: implicit resize while mode activation is in flight (I2)

    /// Ready, then an authenticated portrait hello whose mode activation is still in flight.
    private func resizingSession() -> (Harness, FakeConnection, ConnectionID) {
        let h = Harness().ready()
        h.backend.deferApply = true
        let (c, id) = h.connect(helloFrame(w: 1080, h: 2340, orientation: "portrait"))
        return (h, c, id)
    }

    @Test func helloAckAndKeepalivesFlowWhileResizeActivationIsInFlight() {
        let (h, c, id) = resizingSession()
        #expect(c.jsonTypes == ["helloAck"])
        #expect(h.sink.events.last == .connected)
        #expect(h.backend.pendingApplies.count == 1)
        #expect(h.backend.startCalls.isEmpty)
        #expect(h.ctrl.shouldEncodeNextFrame())   // nothing is captured yet, so nothing is encoded anyway
        // 2.5 s of activation: the session keeps ticking, sending keepalives and feeding the watchdog.
        for _ in 0..<5 {
            h.advance(0.5)
            h.ctrl.receive(jsonFrame(#"{"t":"keepalive"}"#), on: id)
            h.ctrl.tick()
        }
        #expect(h.ctrl.endedReason == nil)
        #expect(c.jsonTypes.filter { $0 == "keepalive" }.count == 2)
        h.backend.completeApply()
        #expect(h.backend.startCalls.count == 1)
        #expect(h.backend.startCalls.first?.w == 1080)
        #expect(h.backend.startCalls.first?.h == 2340)
        #expect(h.backend.log.suffix(2) == ["startCapture", "forceKeyframe"])
    }

    @Test func stopWhileResizeActivationIsInFlightEndsAtOnce() {
        let (h, c, _) = resizingSession()
        h.ctrl.stop(.stopRequested)
        #expect(h.sink.events.last == .ended(.stopRequested))
        #expect(c.jsonTypes.last == "end")
        #expect(h.backend.destroyCalls == 1)
        h.backend.completeApply()   // the late activation result is ignored
        #expect(h.backend.startCalls.isEmpty)
        #expect(h.sink.ended.count == 1)
    }

    @Test func resizeActivationFailureEndsTheSession() {
        let (h, _, _) = resizingSession()
        h.backend.completeApply(.failure(BackendError.captureFailed("mode")))
        #expect(h.ctrl.endedReason == .captureFailed)
        #expect(h.backend.startCalls.isEmpty)
        #expect(h.backend.destroyCalls == 1)
    }

    @Test func pauseDuringResizeActivationDefersCaptureUntilResume() {
        let (h, _, id) = resizingSession()
        h.ctrl.receive(jsonFrame(#"{"t":"pause"}"#), on: id)
        h.backend.completeApply()
        #expect(h.backend.startCalls.isEmpty)
        h.ctrl.receive(jsonFrame(#"{"t":"resume"}"#), on: id)
        #expect(h.backend.startCalls.count == 1)
        #expect(h.backend.startCalls.first?.w == 1080)
    }

    @Test func pauseAndResumeDuringResizeActivationStartCaptureOnce() {
        let (h, _, id) = resizingSession()
        h.ctrl.receive(jsonFrame(#"{"t":"pause"}"#), on: id)
        h.ctrl.receive(jsonFrame(#"{"t":"resume"}"#), on: id)
        #expect(h.backend.startCalls.isEmpty)   // still waiting for the new mode
        #expect(h.sink.events.last == .resumed)
        h.backend.completeApply()
        #expect(h.backend.startCalls.count == 1)
        #expect(h.backend.startCalls.first?.w == 1080)
    }

    @Test func helloVersionMismatchSendsEndAndStops() {
        let h = Harness().ready()
        let (c, _) = h.connect(helloFrame(v: 2))
        #expect(c.jsonTypes == ["end"])
        #expect(c.json.first?["reason"] as? String == "version-mismatch")
        #expect(c.log == ["send", "close"])
        #expect(h.sink.events.last == .ended(.versionMismatch))
        #expect(h.backend.destroyCalls == 1)
    }

    @Test func helloWithOutOfRangeSurfaceIsAProtocolError() {
        let h = Harness().ready()
        let (c, _) = h.connect(helloFrame(w: 100, h: 1080))
        #expect(c.closed)
        #expect(h.sink.events.last == .ended(.protocolError))
        #expect(h.backend.startCalls.isEmpty)
    }

    @Test func helloWithBadTokenAndBadSizeIsJustRejected() {
        let h = Harness().ready()
        let (c, _) = h.connect(helloFrame(token: "x", w: 99999))
        #expect(c.closed)
        #expect(h.ctrl.endedReason == nil)
    }

    @Test func secondConnectionIsRejectedWhileOneIsActive() {
        let h = Harness()
        let (first, _) = h.authed()
        let (second, _) = h.connect(helloFrame())
        #expect(second.closed)
        #expect(second.sent.isEmpty)
        #expect(!first.closed)
        #expect(h.backend.startCalls.count == 1)
        #expect(h.ctrl.endedReason == nil)
    }

    @Test func authenticationClosesOtherPendingConnections() {
        let h = Harness().ready()
        let (pending, _) = h.connect()
        let (winner, _) = h.connect(helloFrame())
        #expect(pending.closed)
        #expect(!winner.closed)
    }

    // MARK: frames from the authenticated phone

    @Test func unknownMessageIsLoggedAndIgnored() {
        let h = Harness()
        let (c, id) = h.authed()
        h.ctrl.receive(jsonFrame(#"{"t":"zoom"}"#), on: id)
        #expect(h.sink.logs(level: "warn").count == 1)
        #expect(h.ctrl.endedReason == nil)
        #expect(!c.closed)
    }

    @Test func unknownMessageIsLoggedOncePerType() {
        let h = Harness()
        let (_, id) = h.authed()
        h.ctrl.receive(jsonFrame(#"{"t":"zoom"}"#), on: id)
        h.ctrl.receive(jsonFrame(#"{"t":"zoom"}"#), on: id)
        h.ctrl.receive(jsonFrame(#"{"t":"pan"}"#), on: id)
        #expect(h.sink.logs(level: "warn").count == 2)
    }

    @Test func phase1ResizeTrackpadAndInputAreIgnored() {
        let h = Harness()
        let (c, id) = h.authed()
        let calls = h.backend.log.count
        h.ctrl.receive(jsonFrame(#"{"t":"resize","surfaceW":1080,"surfaceH":2340,"orientation":"portrait"}"#), on: id)
        h.ctrl.receive(jsonFrame(#"{"t":"setTrackpad","enabled":true}"#), on: id)
        h.ctrl.receive(jsonFrame(#"{"t":"input","e":"click","x":0.5,"y":0.5}"#), on: id)
        h.ctrl.receive(jsonFrame(#"{"t":"input","e":"click","x":0.5,"y":0.5}"#), on: id)
        #expect(h.backend.log.count == calls)
        #expect(h.backend.cursorCalls.isEmpty)
        #expect(h.ctrl.endedReason == nil)
        #expect(!c.closed)
        #expect(h.sink.logs(level: "info").count == 3)   // once per type
        #expect(h.sink.logs(level: "warn").isEmpty)
    }

    @Test func resizeWithOutOfRangeSizeIsAProtocolError() {
        let h = Harness()
        let (_, id) = h.authed()
        h.ctrl.receive(jsonFrame(#"{"t":"resize","surfaceW":0,"surfaceH":2340,"orientation":"portrait"}"#), on: id)
        #expect(h.ctrl.endedReason == .protocolError)
    }

    @Test func videoFromPhoneIsAProtocolError() {
        let h = Harness()
        let (c, id) = h.authed()
        h.ctrl.receive(Framing.video(flags: [], seq: 1, payload: Data([1, 2, 3])), on: id)
        #expect(h.sink.events.last == .ended(.protocolError))
        #expect(c.closed)
    }

    @Test func invalidJsonAfterAuthEndsWithProtocolError() {
        let h = Harness()
        let (_, id) = h.authed()
        h.ctrl.receive(jsonFrame("{nope"), on: id)
        #expect(h.sink.events.last == .ended(.protocolError))
        #expect(h.ctrl.endedReason != .watchdog)
    }

    @Test func knownTypeWithMissingFieldsIsAProtocolError() {
        let h = Harness()
        let (_, id) = h.authed()
        h.ctrl.receive(jsonFrame(#"{"t":"ack"}"#), on: id)
        #expect(h.ctrl.endedReason == .protocolError)
    }

    @Test func framingErrorAfterAuthIsAProtocolError() {
        let h = Harness()
        let (c, id) = h.authed()
        h.ctrl.receive(Data([0, 0, 0, 0]), on: id)
        #expect(h.ctrl.endedReason == .protocolError)
        #expect(c.closed)
    }

    @Test func postAuthFramesMayExceedThePreAuthCap() {
        let h = Harness()
        let (_, id) = h.authed()
        let pad = String(repeating: "x", count: 5000)
        h.ctrl.receive(jsonFrame(#"{"t":"keepalive","pad":"\#(pad)"}"#), on: id)
        #expect(h.ctrl.endedReason == nil)
    }

    @Test func secondHelloAfterAuthIsIgnored() {
        let h = Harness()
        let (_, id) = h.authed()
        h.ctrl.receive(helloFrame(), on: id)
        #expect(h.ctrl.endedReason == nil)
        #expect(h.backend.startCalls.count == 1)
        #expect(h.sink.events.filter { $0 == .connected }.count == 1)
    }

    @Test func framesSplitAcrossReadsAreReassembled() {
        let h = Harness().ready()
        let c = FakeConnection()
        let id = h.ctrl.accept(c)
        let hello = helloFrame()
        h.ctrl.receive(hello.prefix(7), on: id)
        #expect(h.sink.events.last == .ready(displayId: 7, port: 8788))
        h.ctrl.receive(hello.dropFirst(7), on: id)
        #expect(h.sink.events.last == .connected)
    }

    // MARK: watchdog / keepalive / stats

    @Test func watchdogEndsSessionWithout2sKeepalive() {
        let h = Harness()
        _ = h.authed()
        h.advance(1.9)
        h.ctrl.tick()
        #expect(h.ctrl.endedReason == nil)
        h.advance(0.11)
        h.ctrl.tick()
        #expect(h.sink.events.last == .ended(.watchdog))
        #expect(h.backend.destroyCalls == 1)
    }

    @Test func anyValidFrameFeedsTheWatchdog() {
        let h = Harness()
        let (_, id) = h.authed()
        h.encode(1)
        for _ in 0..<10 {
            h.advance(0.5)
            h.ctrl.receive(ackFrame(1), on: id)
            h.ctrl.tick()
        }
        #expect(h.ctrl.endedReason == nil)
    }

    @Test func pausedSessionSurvives9sButEndsAfter10s() {
        let h = Harness()
        let (_, id) = h.authed()
        h.advance(1.5)
        h.ctrl.receive(jsonFrame(#"{"t":"pause"}"#), on: id)
        #expect(h.sink.events.last == .paused)
        #expect(h.backend.stopCaptureCalls == 1)
        h.advance(9)
        h.ctrl.tick()
        #expect(h.ctrl.endedReason == nil)
        h.advance(1.01)
        h.ctrl.tick()
        #expect(h.ctrl.endedReason == .watchdog)
    }

    @Test func resumeRestartsCaptureWithIDR() {
        let h = Harness()
        let (_, id) = h.authed()
        h.ctrl.receive(jsonFrame(#"{"t":"pause"}"#), on: id)
        #expect(h.ctrl.shouldEncodeNextFrame() == false)
        h.ctrl.receive(jsonFrame(#"{"t":"resume"}"#), on: id)
        #expect(h.sink.events.last == .resumed)
        #expect(h.backend.startCalls.count == 2)
        #expect(h.backend.startCalls.last?.w == 2340)
        #expect(h.backend.forceKeyframeCalls == 2)
        #expect(h.ctrl.shouldEncodeNextFrame())
        // Back on the 2 s active watchdog.
        h.advance(2.01)
        h.ctrl.tick()
        #expect(h.ctrl.endedReason == .watchdog)
    }

    @Test func authenticatedConnectionClosedEndsWithWatchdog() {
        let h = Harness()
        let (c, id) = h.authed()
        h.ctrl.closed(id)
        #expect(h.sink.events.last == .ended(.watchdog))
        #expect(!c.jsonTypes.contains("end"))
        #expect(h.backend.destroyCalls == 1)
    }

    @Test func unauthenticatedConnectionClosedKeepsTheSession() {
        let h = Harness().ready()
        let (_, id) = h.connect()
        h.ctrl.closed(id)
        #expect(h.ctrl.endedReason == nil)
    }

    @Test func keepaliveIsSentEverySecond() {
        let h = Harness()
        let (c, id) = h.authed()
        for _ in 0..<4 {
            h.advance(0.5)
            h.ctrl.receive(jsonFrame(#"{"t":"keepalive"}"#), on: id)
            h.ctrl.tick()
        }
        #expect(c.jsonTypes.filter { $0 == "keepalive" }.count == 2)
    }

    @Test func statsAreEmittedEvery5s() {
        let h = Harness()
        let (_, id) = h.authed()
        h.encode(10, bytes: 1000)
        h.advance(0.0625)
        h.ctrl.receive(ackFrame(10), on: id)
        h.ctrl.receive(jsonFrame(#"{"t":"stats","rendered":9,"dropped":1,"decodeMsAvg":4.5}"#), on: id)
        for _ in 0..<4 {
            h.advance(1)
            h.ctrl.receive(jsonFrame(#"{"t":"keepalive"}"#), on: id)
            h.ctrl.tick()
        }
        #expect(!h.sink.events.contains { if case .stats = $0 { return true } else { return false } })
        h.advance(0.9375)
        h.ctrl.tick()
        #expect(h.sink.events.last == .stats(StatsEvent(fps: 2, kbps: 16, unacked: 0, ackP50Ms: 62.5,
                                                        ackP95Ms: 62.5, phoneRendered: 9, phoneDropped: 1)))
    }

    // MARK: flow control

    @Test func skipsEncodingWhenMoreThanTwoUnacked() {
        let h = Harness()
        _ = h.authed()
        h.encode(2)
        #expect(h.ctrl.shouldEncodeNextFrame())
        h.encode(1)
        #expect(h.ctrl.shouldEncodeNextFrame() == false)
    }

    @Test func shouldNotEncodeBeforeAuthentication() {
        let h = Harness().ready()
        #expect(h.ctrl.shouldEncodeNextFrame() == false)
    }

    @Test func ackThatReopensTheWindowEncodesTheHeldFrame() {
        let h = Harness()
        let (_, id) = h.authed()
        h.encode(3)
        h.ctrl.receive(ackFrame(1), on: id)
        #expect(h.backend.unblockedCalls == 1)
        #expect(h.ctrl.shouldEncodeNextFrame())
        h.ctrl.receive(ackFrame(2), on: id)   // window was already open
        #expect(h.backend.unblockedCalls == 1)
    }

    @Test func requestIdrUnblocksFlowControl() {
        let h = Harness()
        let (_, id) = h.authed()
        h.encode(3)
        #expect(h.ctrl.shouldEncodeNextFrame() == false)
        let before = h.backend.forceKeyframeCalls
        h.ctrl.receive(jsonFrame(#"{"t":"requestIdr"}"#), on: id)
        #expect(h.ctrl.shouldEncodeNextFrame())
        #expect(h.backend.forceKeyframeCalls == before + 1)
    }

    @Test func ackStallResetsWindowWithIdr() {
        let h = Harness()
        let (_, id) = h.authed()
        h.encode(3)
        let before = h.backend.forceKeyframeCalls
        h.advance(0.9)
        h.ctrl.receive(jsonFrame(#"{"t":"keepalive"}"#), on: id)
        h.ctrl.tick()
        #expect(h.ctrl.shouldEncodeNextFrame() == false)
        #expect(h.backend.forceKeyframeCalls == before)
        h.advance(0.11)
        h.ctrl.tick()
        #expect(h.ctrl.shouldEncodeNextFrame())
        #expect(h.backend.forceKeyframeCalls == before + 1)
        #expect(h.sink.logs(level: "warn").count == 1)
    }

    @Test func seqIsMonotonicAcrossParameterSets() {
        let h = Harness()
        let (c, _) = h.authed()
        h.encode(2)
        h.ctrl.parameterSets(annexB: Data([0, 0, 0, 1, 0x67]), width: 2340, height: 1080)
        h.encode(1)
        let seqs = c.videoFrames.map(\.seq)
        #expect(seqs == [1, 2, 0, 3])
        #expect(c.videoFrames[2].flags == .config)
    }

    @Test func parameterSetsSendStreamConfigThenConfigFrame() {
        let h = Harness()
        let (c, _) = h.authed()
        let annexB = Data([0, 0, 0, 1, 0x67, 0, 0, 0, 1, 0x68])
        h.ctrl.parameterSets(annexB: annexB, width: 2340, height: 1080)
        let tail = c.frames.suffix(2)
        guard case .json(let body) = tail.first,
              let obj = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] else {
            Issue.record("expected streamConfig JSON"); return
        }
        #expect(obj["t"] as? String == "streamConfig")
        #expect(obj["w"] as? Int == 2340)
        #expect(obj["h"] as? Int == 1080)
        #expect(tail.last == .video(.config, seq: 0, payload: annexB))
    }

    @Test func parameterSetsResetTheWindow() {
        let h = Harness()
        _ = h.authed()
        h.encode(3)
        #expect(h.ctrl.shouldEncodeNextFrame() == false)
        h.ctrl.parameterSets(annexB: Data([0, 0, 0, 1, 0x67]), width: 2340, height: 1080)
        #expect(h.ctrl.shouldEncodeNextFrame())
    }

    @Test func keyframeFlagIsSetOnKeyframes() {
        let h = Harness()
        let (c, _) = h.authed()
        h.ctrl.encoded(annexB: Data([1]), keyframe: true)
        #expect(c.videoFrames.first?.flags == .keyframe)
        #expect(c.videoFrames.first?.seq == 1)
    }

    // MARK: async capture failures

    @Test func asyncPermissionDeniedEndsWithPermissionError() {
        let h = Harness()
        _ = h.authed()
        h.ctrl.captureError(BackendError.permissionDenied)
        #expect(h.sink.events.last == .ended(.permissionScreenRecording))
    }

    @Test func asyncCaptureFailedEndsWithCaptureFailed() {
        let h = Harness()
        _ = h.authed()
        h.ctrl.captureError(BackendError.captureFailed("stream died"))
        #expect(h.sink.events.last == .ended(.captureFailed))
    }

    @Test func asyncCaptureUnavailableAndUnsupportedMapThrough() {
        let a = Harness()
        _ = a.authed()
        a.ctrl.captureError(BackendError.captureUnavailable)
        #expect(a.ctrl.endedReason == .captureUnavailable)
        let b = Harness()
        _ = b.authed()
        b.ctrl.captureError(BackendError.unsupported)
        #expect(b.ctrl.endedReason == .unsupported)
    }

    @Test func nonBackendErrorMapsToCaptureFailed() {
        let h = Harness()
        _ = h.authed()
        h.ctrl.captureError(CocoaError(.fileNoSuchFile))
        #expect(h.ctrl.endedReason == .captureFailed)
    }

    @Test func synchronousStartCaptureThrowGoesThroughTheSameMapping() {
        let h = Harness().ready()
        h.backend.startError = BackendError.permissionDenied
        h.connect(helloFrame())
        #expect(h.ctrl.endedReason == .permissionScreenRecording)
    }

    // MARK: stop

    @Test func byeEndsWithPhoneBye() {
        let h = Harness()
        let (_, id) = h.authed()
        h.ctrl.receive(jsonFrame(#"{"t":"bye","reason":"user-exit"}"#), on: id)
        #expect(h.sink.events.last == .ended(.phoneBye))
    }

    @Test func stopIsIdempotent() {
        let h = Harness()
        _ = h.authed()
        h.ctrl.stop(.stopRequested)
        h.ctrl.stop(.watchdog)
        #expect(h.sink.ended == [.ended(.stopRequested)])
        #expect(h.backend.destroyCalls == 1)
        #expect(h.ctrl.endedReason == .stopRequested)
    }

    @Test func stopSendsEndToTheAuthenticatedPhone() {
        let h = Harness()
        let (c, _) = h.authed()
        h.ctrl.stop(.stopRequested)
        #expect(c.json.last?["t"] as? String == "end")
        #expect(c.json.last?["reason"] as? String == "stop-requested")
        #expect(c.log.suffix(2) == ["send", "close"])
        #expect(h.backend.log.suffix(2) == ["stopCapture", "destroyDisplay"])
        #expect(h.sink.events.last == .ended(.stopRequested))
    }

    @Test func stopClosesPendingConnectionsWithoutSendingEnd() {
        let h = Harness().ready()
        let (c, _) = h.connect()
        h.ctrl.stop(.signal)
        #expect(c.closed)
        #expect(c.sent.isEmpty)
    }

    @Test func nothingHappensAfterStop() {
        let h = Harness()
        let (c, id) = h.authed()
        h.ctrl.stop(.stopRequested)
        let sent = c.sent.count
        h.advance(30)
        h.ctrl.tick()
        h.ctrl.receive(jsonFrame(#"{"t":"keepalive"}"#), on: id)
        h.ctrl.encoded(annexB: Data([1]), keyframe: false)
        let late = FakeConnection()
        _ = h.ctrl.accept(late)
        #expect(c.sent.count == sent)
        #expect(late.closed)
        #expect(h.sink.ended.count == 1)
        #expect(h.ctrl.shouldEncodeNextFrame() == false)
    }
}
