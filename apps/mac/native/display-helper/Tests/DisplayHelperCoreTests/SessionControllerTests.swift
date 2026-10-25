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
    var mainAsleep = false
    var mainAsleepCalls = 0
    /// `displayIsOnline()`: false once macOS took the display out of the desktop.
    var online = true

    var createCalls = 0
    var createArgs: (maxPixels: Int, size: CGSize)?
    /// `serialNum` of every `createDisplay` call, in order.
    var createSerials: [UInt32] = []
    /// Thrown by the Nth `createDisplay` call (1-based), on top of `createError`.
    var createErrorsByCall: [Int: Error] = [:]
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
    /// When set, `applyModes` also simulates macOS picking a mode and the helper's activation
    /// decision, and `widthPoints` follows the resulting active mode.
    var macOS: SimulatedMacOSModes?
    var cursorCalls: [Bool] = []
    /// Ordered record of the calls that matter for sequencing assertions.
    var log: [String] = []
    var waitTimeout: TimeInterval?
    var waitCompletion: ((Result<Void, BackendError>) -> Void)?

    /// `mirrorVerdict()`: `.mirrored(mirrorWhy)` while `mirrored`, or for a display created with a serial
    /// in `mirroredSerials` from its `mirrorAppearsAtCheck`-th query on (1 = already mirrored at the first
    /// query; later = WindowServer restored the saved mirror set a little after activation). The first
    /// `unknownChecks` queries of every display answer `.unknown` (CG in our process has not listed it
    /// yet, F-M1).
    var mirrored = false
    var mirroredSerials: Set<UInt32> = []
    var mirrorAppearsAtCheck = 1
    var unknownChecks = 0
    var mirrorWhy = "CGDisplayIsInMirrorSet(0x00000007)=1"
    var mirrorChecks = 0
    private var mirrorChecksThisDisplay = 0
    func mirrorVerdict() -> MirrorVerdict {
        mirrorChecks += 1
        mirrorChecksThisDisplay += 1
        if mirrored { return .mirrored(mirrorWhy) }
        if mirrorChecksThisDisplay <= unknownChecks { return .unknown }
        guard let serial = createSerials.last, mirroredSerials.contains(serial) else { return .notMirrored }
        return mirrorChecksThisDisplay >= mirrorAppearsAtCheck ? .mirrored(mirrorWhy) : .notMirrored
    }
    /// When true, `runLater` work is held in `pendingLater` (fired by `fireLater`) instead of running inline.
    var deferLater = false
    var pendingLater: [(delay: TimeInterval, work: () -> Void)] = []
    func runLater(after delay: TimeInterval, _ work: @escaping () -> Void) {
        if deferLater { return pendingLater.append((delay, work)) }
        work()
    }
    func fireLater() {
        guard !pendingLater.isEmpty else { Issue.record("no runLater work is pending"); return }
        pendingLater.removeFirst().work()
    }

    func preflightScreenRecording() -> Bool { screenRecording }
    func preflightPostEvent() -> Bool { postEvent }
    func mainDisplayAsleep() -> Bool { mainAsleepCalls += 1; return mainAsleep }
    func displayIsOnline() -> Bool { online }
    func createDisplay(maxPixels: Int, sizeInMillimeters: CGSize, serialNum: UInt32,
                       vendorId: UInt32, productId: UInt32) throws -> UInt32 {
        createCalls += 1
        createSerials.append(serialNum)
        mirrorChecksThisDisplay = 0
        log.append("createDisplay")
        if let createError { throw createError }
        if let error = createErrorsByCall[createCalls] { throw error }
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
    /// Per serial: the raw `CGDisplayIsOnline` value and mirror verdict each activation attempt sees
    /// (the last entry repeats). When the created serial has a script, `applyModes` runs the real
    /// `ActivationPoll.preconfigureGuard` + `ActivationPoll` over it (a guard pass counts as `.kept`) and
    /// completes the way `VirtualDisplayController` does.
    var activationScripts: [UInt32: [(online: Int32, mirror: MirrorVerdict)]] = [:]
    /// Attempts the last scripted activation made.
    var scriptedAttempts = 0
    private func runActivationScript(_ script: [(online: Int32, mirror: MirrorVerdict)]) -> Result<Void, Error> {
        var poll = ActivationPoll()
        scriptedAttempts = 0
        while true {
            let step = script[min(scriptedAttempts, script.count - 1)]
            scriptedAttempts += 1
            let attempt = ActivationPoll.preconfigureGuard(online: step.online, mirror: { step.mirror }) ?? .kept
            switch poll.record(attempt) {
            case .finished: return .success(())
            case .retry: continue
            case .failed(.displayOffline): return .failure(BackendError.displayOffline)
            case .failed(.displayMirrored(let why)): return .failure(BackendError.displayMirrored(why))
            case .failed: return .failure(BackendError.unsupported)
            }
        }
    }
    func applyModes(_ modes: [ModeSpec], completion: @escaping (Result<Void, Error>) -> Void) {
        log.append("applyModes")
        applied.append(modes)
        if let serial = createSerials.last, let script = activationScripts[serial] {
            return completion(runActivationScript(script))
        }
        if let macOS {
            macOS.apply(modes)
            if let active = macOS.active { widthPoints = active.widthPoints }
        }
        if deferApply { return pendingApplies.append(completion) }
        if let applyError { return completion(.failure(applyError)) }
        completion(.success(()))
    }
    /// When true, `refreshCaptureTarget` completions are held in `pendingRefreshes`.
    var deferRefresh = false
    var pendingRefreshes: [(Result<Void, BackendError>) -> Void] = []
    var refreshCalls = 0
    var refreshResult: Result<Void, BackendError> = .success(())
    func refreshCaptureTarget(completion: @escaping (Result<Void, BackendError>) -> Void) {
        refreshCalls += 1
        log.append("refreshCaptureTarget")
        if deferRefresh { return pendingRefreshes.append(completion) }
        completion(refreshResult)
    }
    func completeRefresh(_ result: Result<Void, BackendError> = .success(())) { pendingRefreshes.removeFirst()(result) }
    func currentWidthPoints() -> Int { widthPoints }
    /// Overrides `displayBounds()` (e.g. after the user moved the display in the arrangement).
    var bounds: CGRect?
    func displayBounds() -> CGRect { bounds ?? CGRect(x: 0, y: 0, width: widthPoints, height: 432) }
    func destroyDisplay() { destroyCalls += 1; log.append("destroyDisplay") }
}

/// macOS mode handling as observed on device run 4 (F2): after `applySettings`, macOS lists the HiDPI
/// and 1x variant of every applied spec (small point sizes unusable for the desktop) and restores the
/// mode it remembers for this display identity in the new orientation; the helper's
/// `ModeActivation.decide` then keeps that mode or switches. The resulting mode is remembered.
final class SimulatedMacOSModes {
    /// Remembered active mode per orientation (key: landscape).
    var remembered: [Bool: DisplayModeInfo]
    /// `isUsableForDesktopGUI()`: 432x904 (2.5) and 360x752 (3.0) are not on this Mac; 540x1130 is.
    var isUsable: (ModeSpec) -> Bool = { min($0.widthPoints, $0.heightPoints) >= 520 }
    private(set) var active: DisplayModeInfo?
    private(set) var decisions: [ModeDecision] = []

    init(remembered: [Bool: DisplayModeInfo] = [:]) { self.remembered = remembered }

    static func hiDPI(_ w: Int, _ h: Int) -> DisplayModeInfo {
        DisplayModeInfo(widthPoints: w, heightPoints: h, pixelWidth: 2 * w, pixelHeight: 2 * h)
    }

    func apply(_ specs: [ModeSpec]) {
        guard let first = specs.first else { return }
        let landscape = first.widthPoints >= first.heightPoints
        let available = specs.flatMap { spec -> [DisplayModeInfo] in
            let u = isUsable(spec)
            return [DisplayModeInfo(widthPoints: spec.widthPoints, heightPoints: spec.heightPoints,
                                    pixelWidth: 2 * spec.widthPoints, pixelHeight: 2 * spec.heightPoints, usableForDesktop: u),
                    DisplayModeInfo(widthPoints: spec.widthPoints, heightPoints: spec.heightPoints,
                                    pixelWidth: spec.widthPoints, pixelHeight: spec.heightPoints, usableForDesktop: u)]
        }
        // Restore the remembered mode if listed; otherwise the largest usable HiDPI mode.
        let restored = remembered[landscape].flatMap { r in available.contains(r) ? r : nil }
            ?? available.filter { $0.isHiDPI && $0.usableForDesktop }.max { $0.widthPoints < $1.widthPoints }
        let decision = ModeActivation.decide(current: restored, available: available, applied: specs)
        decisions.append(decision)
        switch decision {
        case .keep(let m), .activate(let m): active = m
        case .noneAvailable: active = restored
        }
        remembered[landscape] = active
    }
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
    /// The per-session "using the primary/spare/fresh display identity" info line, kept out of `events` so
    /// exact-sequence assertions elsewhere need not list it.
    var identityLogs: [String] = []
    func emit(_ event: HelperEvent) {
        if case .log("info", let m) = event, m.hasPrefix("using the "), m.contains("display identity") {
            return identityLogs.append(m)
        }
        events.append(event)
    }
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

func resizeFrame(w: Int, h: Int) -> Data {
    jsonFrame(#"{"t":"resize","surfaceW":\#(w),"surfaceH":\#(h),"orientation":"\#(w >= h ? "landscape" : "portrait")"}"#)
}

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

    init(w: Int = 2340, h: Int = 1080, freshSerial: UInt32? = nil) {
        start = StartCommand(sessionId: "s1", token: "tok", port: 8788, surfaceW: w, surfaceH: h,
                             orientation: w >= h ? .landscape : .portrait, serialNum: 42,
                             vendorId: 0x3456, productId: 0x4D44, dpi: nil, freshSerial: freshSerial)
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
        #expect(h.sink.events == [.ready(displayId: 7, port: 8788, serialNum: 42)])
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
        #expect(h.sink.events == [.ready(displayId: 7, port: 8788, serialNum: 42)])
    }

    @Test func initialModeActivationFailureEndsUnsupportedAndDestroysTheDisplay() {
        let h = Harness()
        h.backend.deferApply = true
        h.ctrl.begin()
        h.backend.completeApply(.failure(BackendError.unsupported))
        #expect(h.sink.ended == [.ended(.unsupported)])
        #expect(!h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: 42)))
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
        #expect(!h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: 42)))
        #expect(h.backend.destroyCalls == 0)
    }

    // MARK: begin() — accurate start-failure reasons (F1, F2)

    @Test func initialActivationOfflineOnBothIdentitiesEndsDisplayOffline() {
        let h = Harness()
        h.backend.deferApply = true
        h.ctrl.begin()
        h.backend.completeApply(.failure(BackendError.displayOffline))   // primary
        #expect(h.sink.ended.isEmpty)
        h.backend.completeApply(.failure(BackendError.displayOffline))   // spare
        #expect(h.sink.ended == [.ended(.displayOffline)])
        #expect(h.backend.createSerials == [42, DisplayIdentity.spareSerial(for: 42)])
        #expect(h.backend.destroyCalls == 2)
        #expect(h.backend.waitTimeout == nil)
    }

    // MARK: begin() — spare display identity when macOS keeps the primary switched off

    @Test func anOfflinePrimaryIsDestroyedAndRecreatedOnceWithTheSpareIdentity() {
        let h = Harness()
        h.backend.deferApply = true
        h.ctrl.begin()
        #expect(h.backend.createSerials == [42])
        h.backend.completeApply(.failure(BackendError.displayOffline))
        #expect(h.backend.log == ["createDisplay", "applyModes", "destroyDisplay", "createDisplay", "applyModes"])
        #expect(h.backend.createSerials == [42, DisplayIdentity.spareSerial(for: 42)])
        #expect(h.backend.applied.count == 2 && h.backend.applied[0] == h.backend.applied[1])
        #expect(h.sink.logs(level: "warn").contains { $0.contains("switched off") && $0.contains("spare") })
        h.backend.completeApply()
        #expect(h.backend.log.last == "waitUntilCapturable")
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: DisplayIdentity.spareSerial(for: 42))))
        #expect(h.sink.ended.isEmpty)
        #expect(h.backend.destroyCalls == 1)
        let spare = String(format: "0x%08x", DisplayIdentity.spareSerial(for: 42))
        #expect(h.sink.identityLogs.count == 1)
        #expect(h.sink.identityLogs.contains { $0.contains("spare display identity") && $0.contains(spare) })
    }

    @Test func aWorkingPrimaryIsUsedAndLoggedWithoutTheSpare() {
        let h = Harness()
        h.ready()
        #expect(h.backend.createSerials == [42])
        #expect(h.backend.destroyCalls == 0)
        #expect(h.sink.identityLogs.count == 1)
        #expect(h.sink.identityLogs.contains { $0.contains("primary display identity") && $0.contains("0x0000002a") })
    }

    @Test func eachSessionTriesThePrimaryFirst() {
        // The helper keeps no state across sessions: the user's original arrangement wins once fixed.
        let first = Harness()
        first.backend.deferApply = true
        first.ctrl.begin()
        first.backend.completeApply(.failure(BackendError.displayOffline))
        first.backend.completeApply()
        let second = Harness()
        second.ready()
        #expect(second.backend.createSerials == [42])
    }

    @Test func anOfflinePrimaryWhileTheMacSleepsEndsMacAsleepWithoutTheSpare() {
        // Creating another display while asleep would leave a second ghost (F2).
        let h = Harness()
        h.backend.deferApply = true
        h.backend.mainAsleep = true
        h.ctrl.begin()
        h.backend.completeApply(.failure(BackendError.displayOffline))
        #expect(h.sink.ended == [.ended(.macAsleep)])
        #expect(h.backend.createCalls == 1)
    }

    @Test func otherActivationFailuresDoNotTryTheSpare() {
        let h = Harness()
        h.backend.deferApply = true
        h.ctrl.begin()
        h.backend.completeApply(.failure(BackendError.unsupported))
        #expect(h.sink.ended == [.ended(.unsupported)])
        #expect(h.backend.createCalls == 1)
    }

    @Test func aSpareThatCannotBeCreatedEndsUnsupported() {
        let h = Harness()
        h.backend.deferApply = true
        h.backend.createErrorsByCall[2] = BackendError.unsupported
        h.ctrl.begin()
        h.backend.completeApply(.failure(BackendError.displayOffline))
        #expect(h.sink.ended == [.ended(.unsupported)])
        #expect(h.backend.createCalls == 2)
        #expect(h.backend.destroyCalls == 1)   // the primary; the spare never existed
        #expect(h.backend.pendingApplies.isEmpty)
    }

    @Test func aStopDuringThePrimaryActivationNeverCreatesTheSpare() {
        let h = Harness()
        h.backend.deferApply = true
        h.ctrl.begin()
        h.ctrl.stop(.stopRequested)
        h.backend.completeApply(.failure(BackendError.displayOffline))
        #expect(h.backend.createCalls == 1)
        #expect(h.sink.ended == [.ended(.stopRequested)])
    }

    @Test func aStopDuringTheSpareActivationIgnoresItsLateResult() {
        let h = Harness()
        h.backend.deferApply = true
        h.ctrl.begin()
        h.backend.completeApply(.failure(BackendError.displayOffline))
        h.ctrl.stop(.stopRequested)
        #expect(h.sink.ended == [.ended(.stopRequested)])
        h.backend.completeApply(.failure(BackendError.displayOffline))
        #expect(h.sink.ended == [.ended(.stopRequested)])
        #expect(h.backend.createCalls == 2)
    }

    // MARK: begin() — fresh display identity when every known one is switched off (Ruling P0-7)

    /// begin(), then the primary and the spare both report `displayOffline`, `dt` apart.
    private func bothKnownOffline(_ h: Harness, primaryAfter: TimeInterval = 1.1, spareAfter: TimeInterval = 1.2) {
        h.backend.deferApply = true
        h.ctrl.begin()
        h.advance(primaryAfter)
        h.backend.completeApply(.failure(BackendError.displayOffline))   // primary
        h.advance(spareAfter)
        h.backend.completeApply(.failure(BackendError.displayOffline))   // spare
    }

    @Test func bothKnownIdentitiesOfflineEscalateToTheFreshIdentity() {
        let h = Harness(freshSerial: 99)
        bothKnownOffline(h)
        #expect(h.sink.ended.isEmpty)
        #expect(h.backend.createSerials == [42, DisplayIdentity.spareSerial(for: 42), 99])
        #expect(h.backend.log == ["createDisplay", "applyModes", "destroyDisplay", "createDisplay", "applyModes",
                                  "destroyDisplay", "createDisplay", "applyModes"])
        #expect(h.sink.logs(level: "warn").contains { $0.contains("fresh display identity 0x00000063") })
        h.backend.completeApply()
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: 99)))
        #expect(h.sink.ended.isEmpty)
        #expect(h.backend.destroyCalls == 2)
        #expect(h.sink.identityLogs.count == 1)
        #expect(h.sink.identityLogs.first?.contains("using the fresh display identity 0x00000063") == true)
    }

    @Test func withoutAFreshSerialBothOfflineStillEndDisplayOffline() {
        // An older main sends no freshSerial: the helper behaves exactly as before.
        let h = Harness()
        bothKnownOffline(h)
        #expect(h.sink.ended == [.ended(.displayOffline)])
        #expect(h.backend.createCalls == 2)
    }

    @Test func anOfflineFreshIdentityEndsDisplayOfflineWithoutAFourthTry() {
        let h = Harness(freshSerial: 99)
        bothKnownOffline(h)
        h.backend.completeApply(.failure(BackendError.displayOffline))   // fresh
        // M1: main must know the fresh identity is used up too.
        #expect(h.sink.ended == [.ended(.displayOffline, freshTried: true)])
        #expect(h.backend.createCalls == 3)
        #expect(h.backend.destroyCalls == 3)
        #expect(h.backend.pendingApplies.isEmpty)
    }

    @Test func aSpareOfflineWhileTheMacSleepsEndsMacAsleepWithoutTheFreshIdentity() {
        let h = Harness(freshSerial: 99)
        h.backend.deferApply = true
        h.ctrl.begin()
        h.backend.completeApply(.failure(BackendError.displayOffline))   // primary, awake
        h.backend.mainAsleep = true
        h.backend.completeApply(.failure(BackendError.displayOffline))   // spare, asleep
        #expect(h.sink.ended == [.ended(.macAsleep)])
        #expect(h.backend.createCalls == 2)
    }

    @Test func noFreshIdentityOnceTheEscalationCutoffHasPassed() {
        // Keeps the whole start well inside the phone's 12 s reply timeout.
        let h = Harness(freshSerial: 99)
        bothKnownOffline(h, primaryAfter: 2.0, spareAfter: SessionController.freshIdentityCutoff - 2.0 + 0.01)
        #expect(h.sink.ended == [.ended(.displayOffline, freshTried: false)])
        #expect(h.backend.createCalls == 2)
        #expect(h.sink.logs(level: "warn").contains { $0.contains("no time left") })
    }

    @Test func theFreshIdentityIsTriedJustInsideTheCutoff() {
        let h = Harness(freshSerial: 99)
        bothKnownOffline(h, primaryAfter: 2.0, spareAfter: SessionController.freshIdentityCutoff - 2.0)
        #expect(h.sink.ended.isEmpty)
        #expect(h.backend.createSerials.last == 99)
    }

    @Test func otherSpareFailuresDoNotTryTheFreshIdentity() {
        let h = Harness(freshSerial: 99)
        h.backend.deferApply = true
        h.ctrl.begin()
        h.backend.completeApply(.failure(BackendError.displayOffline))   // primary
        h.backend.completeApply(.failure(BackendError.unsupported))      // spare
        #expect(h.sink.ended == [.ended(.unsupported)])
        #expect(h.backend.createCalls == 2)
    }

    @Test func aFreshIdentityThatCannotBeCreatedEndsUnsupported() {
        let h = Harness(freshSerial: 99)
        h.backend.createErrorsByCall[3] = BackendError.unsupported
        bothKnownOffline(h)
        #expect(h.sink.ended == [.ended(.unsupported)])
        #expect(h.backend.createCalls == 3)
        #expect(h.backend.destroyCalls == 2)
    }

    @Test func aStopDuringTheFreshActivationIgnoresItsLateResult() {
        let h = Harness(freshSerial: 99)
        bothKnownOffline(h)
        h.ctrl.stop(.stopRequested)
        h.backend.completeApply()
        #expect(h.sink.ended == [.ended(.stopRequested, freshTried: true)])
        #expect(h.backend.waitTimeout == nil)
    }

    @Test func readyNamesThePrimaryIdentityWhenItWorks() {
        let h = Harness(freshSerial: 99)
        h.ready()
        #expect(h.sink.events == [.ready(displayId: 7, port: 8788, serialNum: 42)])
        #expect(h.backend.createSerials == [42])
    }

    // MARK: begin() — an identity macOS restores as mirrored is dropped like a switched-off one

    private var spare: UInt32 { DisplayIdentity.spareSerial(for: 42) }

    @Test func aMirroredPrimaryIsDroppedForTheSpare() {
        let h = Harness()
        h.backend.mirroredSerials = [42]
        h.ctrl.begin()
        #expect(h.backend.createSerials == [42, spare])
        #expect(h.backend.log == ["createDisplay", "applyModes", "destroyDisplay", "createDisplay", "applyModes",
                                  "waitUntilCapturable"])
        #expect(h.sink.logs(level: "warn").contains {
            $0.contains("mirror") && $0.contains("0x0000002a") && $0.contains("spare display identity")
        })
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: spare, mirroredSkipped: true)))
        #expect(h.sink.ended.isEmpty)
        #expect(h.backend.destroyCalls == 1)
        // Only the identity that is used gets the "using the …" line.
        #expect(h.sink.identityLogs.count == 1)
        #expect(h.sink.identityLogs.first?.contains("using the spare display identity") == true)
    }

    @Test func aMirroredSpareFallsThroughToTheFreshIdentity() {
        let h = Harness(freshSerial: 99)
        h.backend.mirroredSerials = [42, spare]
        h.ctrl.begin()
        #expect(h.backend.createSerials == [42, spare, 99])
        #expect(h.backend.destroyCalls == 2)
        #expect(h.sink.logs(level: "warn").contains { $0.contains("mirror") && $0.contains("fresh display identity 0x00000063") })
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: 99, mirroredSkipped: true)))
        #expect(h.sink.ended.isEmpty)
    }

    @Test func everyIdentityMirroredEndsDisplayOfflineWithFreshTried() {
        let h = Harness(freshSerial: 99)
        h.backend.mirroredSerials = [42, spare, 99]
        h.ctrl.begin()
        // Main burns the generation after the fresh one (g+2), exactly as for a switched-off fresh identity.
        #expect(h.sink.ended == [.ended(.displayOffline, freshTried: true)])
        #expect(h.backend.createSerials == [42, spare, 99])
        #expect(h.backend.destroyCalls == 3)
        #expect(h.backend.waitTimeout == nil)
        #expect(!h.sink.events.contains { if case .ready = $0 { return true } else { return false } })
        #expect(h.sink.logs(level: "error").contains { $0.contains("mirror") && $0.contains("0x00000063") })
    }

    @Test func bothKnownIdentitiesMirroredWithoutAFreshSerialEndDisplayOffline() {
        let h = Harness()
        h.backend.mirroredSerials = [42, spare]
        h.ctrl.begin()
        #expect(h.sink.ended == [.ended(.displayOffline, freshTried: false)])
        #expect(h.backend.createCalls == 2)
    }

    @Test func offlineAndMirroredIdentitiesShareOneFallbackChain() {
        let h = Harness(freshSerial: 99)
        h.backend.deferApply = true
        h.backend.mirroredSerials = [spare]
        h.ctrl.begin()
        h.backend.completeApply(.failure(BackendError.displayOffline))   // primary switched off
        h.backend.completeApply()                                          // spare comes up mirrored
        #expect(h.backend.createSerials == [42, spare, 99])
        h.backend.completeApply()                                          // fresh: extended
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: 99, mirroredSkipped: true)))
    }

    @Test func aMirroredPrimaryWhileTheMacSleepsEndsMacAsleepWithoutTheSpare() {
        let h = Harness()
        h.backend.mirroredSerials = [42]
        h.backend.mainAsleep = true
        h.ctrl.begin()
        #expect(h.sink.ended == [.ended(.macAsleep)])
        #expect(h.backend.createCalls == 1)
    }

    @Test func aMirrorRestoredShortlyAfterActivationIsStillCaught() {
        // WindowServer applies the saved set in `request_resources`, possibly after activation lands.
        let h = Harness()
        h.backend.deferLater = true
        h.backend.mirroredSerials = [42]
        h.backend.mirrorAppearsAtCheck = 4
        h.ctrl.begin()
        #expect(h.backend.mirrorChecks == 1)
        #expect(h.backend.waitTimeout == nil)
        #expect(h.backend.pendingLater.map(\.delay) == [MirrorSettlePoll.interval])
        for _ in 0..<3 {
            h.advance(MirrorSettlePoll.interval)
            h.backend.fireLater()
        }
        #expect(h.backend.createSerials == [42, spare])
        #expect(h.backend.destroyCalls == 1)
        while !h.backend.pendingLater.isEmpty { h.backend.fireLater() }   // the spare settles unmirrored
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: spare, mirroredSkipped: true)))
    }

    @Test func anUnmirroredIdentityIsCheckedForTheWholeSettleWindowThenUsed() {
        let h = Harness()
        h.backend.deferLater = true
        h.ctrl.begin()
        var fired = 0
        while !h.backend.pendingLater.isEmpty {
            #expect(h.backend.waitTimeout == nil)
            h.backend.fireLater()
            fired += 1
        }
        #expect(fired == MirrorSettlePoll.checks - 1)
        #expect(h.backend.mirrorChecks == MirrorSettlePoll.checks)
        #expect(h.backend.log.last == "waitUntilCapturable")
        #expect(h.backend.createSerials == [42])
    }

    @Test func aStopDuringTheMirrorSettleIgnoresTheLateCheck() {
        let h = Harness()
        h.backend.deferLater = true
        h.backend.mirroredSerials = [42]
        h.backend.mirrorAppearsAtCheck = 2
        h.ctrl.begin()
        h.ctrl.stop(.stopRequested)
        h.backend.fireLater()
        #expect(h.sink.ended == [.ended(.stopRequested)])
        #expect(h.backend.createCalls == 1)
        #expect(h.backend.destroyCalls == 1)
        #expect(h.backend.waitTimeout == nil)
    }

    // MARK: fix round 1 — ready reports a mirror-skipped identity (I1), activation-time mirror (I2), pre-ready re-check

    @Test func readyReportsThatAMirroredIdentityWasSkipped() {
        let h = Harness()
        h.backend.mirroredSerials = [42]
        h.ready()
        #expect(h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: spare, mirroredSkipped: true)))
    }

    @Test func readyAfterAnOfflinePrimaryDoesNotClaimAMirror() {
        let h = Harness()
        h.backend.deferApply = true
        h.ctrl.begin()
        h.backend.completeApply(.failure(BackendError.displayOffline))
        h.backend.completeApply()
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: spare, mirroredSkipped: false)))
    }

    @Test func readyOnTheFreshIdentityAfterAMirroredSpareReportsTheSkip() {
        let h = Harness(freshSerial: 99)
        h.backend.deferApply = true
        h.backend.mirroredSerials = [spare]
        h.ctrl.begin()
        h.backend.completeApply(.failure(BackendError.displayOffline))   // primary offline
        h.backend.completeApply()                                          // spare mirrored
        h.backend.completeApply()                                          // fresh
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: 99, mirroredSkipped: true)))
    }

    @Test func anActivationThatReportsAMirrorDropsTheIdentity() {
        let h = Harness()
        h.backend.deferApply = true
        h.ctrl.begin()
        h.backend.completeApply(.failure(BackendError.displayMirrored("CGDisplayIsInMirrorSet(0x000000c3)=1")))
        #expect(h.backend.createSerials == [42, spare])
        #expect(h.sink.logs(level: "warn").contains { $0.contains("mirror") && $0.contains("0x0000002a") })
        #expect(h.sink.ended.isEmpty)
        h.backend.completeApply()
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: spare, mirroredSkipped: true)))
    }

    @Test func anotherActivationFailureOnAMirroredDisplayDropsItInsteadOfEndingUnsupported() {
        // A mirror secondary may never get its HiDPI mode (modeUnavailable / modeSwitchFailed).
        let h = Harness()
        h.backend.deferApply = true
        h.backend.mirroredSerials = [42]
        h.ctrl.begin()
        h.backend.completeApply(.failure(BackendError.unsupported))
        #expect(h.backend.createSerials == [42, spare])
        #expect(h.sink.ended.isEmpty)
    }

    @Test func everyIdentityReportingAMirrorAtActivationEndsDisplayOffline() {
        let h = Harness(freshSerial: 99)
        h.backend.applyError = BackendError.displayMirrored("CGDisplayIsInMirrorSet(0x00000007)=1")
        h.ctrl.begin()
        #expect(h.sink.ended == [.ended(.displayOffline, freshTried: true)])
        #expect(h.backend.createSerials == [42, spare, 99])
    }

    @Test func aMirrorThatLandsAfterTheSettleWindowIsCaughtBeforeReady() {
        let h = Harness()
        h.backend.mirroredSerials = [42]
        h.backend.mirrorAppearsAtCheck = MirrorSettlePoll.checks + 1
        h.ctrl.begin()
        #expect(h.backend.createSerials == [42])
        h.backend.waitCompletion?(.success(()))                          // the pre-ready check sees it
        #expect(h.backend.createSerials == [42, spare])
        #expect(!h.sink.events.contains { if case .ready = $0 { return true } else { return false } })
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: spare, mirroredSkipped: true)))
    }

    @Test func aLateMirrorPastTheCutoffIsStreamedAndLogged() {
        // No time left in this start for another identity: keep the session (as for a mid-session mirror).
        let h = Harness()
        h.backend.mirroredSerials = [42]
        h.backend.mirrorAppearsAtCheck = MirrorSettlePoll.checks + 1
        h.ctrl.begin()
        h.advance(SessionController.freshIdentityCutoff + 0.1)
        h.backend.waitCompletion?(.success(()))
        #expect(h.backend.createSerials == [42])
        #expect(h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: 42, mirroredSkipped: false)))
        #expect(h.sink.logs(level: "warn").contains { $0.contains("mirror") && $0.contains("0x0000002a") })
    }

    @Test func aMirroredDisplayRefusingTheHelloResizeKeepsTheSession() {
        // Mid-session the display is never mode-switched while mirrored; the stream keeps the current mode.
        let h = Harness()
        h.ready()
        h.backend.applyError = BackendError.displayMirrored("CGDisplayIsInMirrorSet(0x00000007)=1")
        let (c, _) = h.connect(helloFrame(w: 2400, h: 1080))
        #expect(h.ctrl.endedReason == nil)
        #expect(c.jsonTypes.contains("helloAck"))
        #expect(h.backend.startCalls.count == 1)
    }

    // MARK: F-M1 — a display CG in our process does not list yet is not mirrored; every judgement logs its query

    @Test func aSettleCheckThatCannotTellYetDoesNotDropTheIdentity() {
        let h = Harness()
        h.backend.unknownChecks = 2
        h.ctrl.begin()
        #expect(h.backend.createSerials == [42])
        #expect(h.backend.mirrorChecks == MirrorSettlePoll.checks)
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: 42, mirroredSkipped: false)))
        #expect(!h.sink.logs(level: "warn").contains { $0.contains("mirror") })
    }

    @Test func theFreshIdentityAfterAMirroredSpareSurvivesChecksCGCannotAnswerYet() {
        // Device run 7: primary offline, spare genuinely mirrored, then the fresh one (extended per
        // WindowServer) while CG in our process had not listed it yet.
        let h = Harness(freshSerial: 99)
        h.backend.deferApply = true
        h.backend.mirroredSerials = [spare]
        h.backend.unknownChecks = 2
        h.ctrl.begin()
        h.backend.completeApply(.failure(BackendError.displayOffline))   // primary offline
        h.backend.completeApply()                                          // spare: unknown, unknown, mirrored
        #expect(h.backend.createSerials == [42, spare, 99])
        h.backend.completeApply()                                          // fresh: unknown, unknown, clear
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.ended.isEmpty)
        #expect(h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: 99, mirroredSkipped: true)))
    }

    @Test func aMirrorAtActivationLogsTheQueryThatFired() {
        let h = Harness()
        h.backend.deferApply = true
        h.ctrl.begin()
        h.backend.completeApply(.failure(BackendError.displayMirrored("CGDisplayIsInMirrorSet(0x000000c3)=1")))
        #expect(h.sink.logs(level: "warn").contains {
            $0.contains("0x0000002a") && $0.contains("before configuring") && $0.contains("CGDisplayIsInMirrorSet(0x000000c3)=1")
        })
    }

    @Test func aMirrorAtASettleCheckLogsTheQueryThatFired() {
        let h = Harness()
        h.backend.mirroredSerials = [42]
        h.backend.mirrorWhy = "CGDisplayMirrorsDisplay(0x00000001)=0x00000007"
        h.ctrl.begin()
        #expect(h.sink.logs(level: "warn").contains {
            $0.contains("0x0000002a") && $0.contains("settle check 1")
                && $0.contains("CGDisplayMirrorsDisplay(0x00000001)=0x00000007")
        })
    }

    @Test func aMirrorFoundAfterAFailedActivationLogsTheQueryThatFired() {
        let h = Harness()
        h.backend.deferApply = true
        h.backend.mirroredSerials = [42]
        h.ctrl.begin()
        h.backend.completeApply(.failure(BackendError.unsupported))
        #expect(h.sink.logs(level: "warn").contains {
            $0.contains("0x0000002a") && $0.contains("after a failed activation") && $0.contains(h.backend.mirrorWhy)
        })
    }

    @Test func theLastIdentityJudgedMirroredStillLogsTheQueryThatFired() {
        let h = Harness(freshSerial: 99)
        h.backend.mirroredSerials = [42, spare, 99]
        h.ctrl.begin()
        #expect(h.sink.ended == [.ended(.displayOffline, freshTried: true)])
        let judged = h.sink.logs(level: "warn").filter { $0.contains(h.backend.mirrorWhy) }
        #expect(judged.count == 3)
        #expect(judged.last?.contains("0x00000063") == true)
    }

    @Test func aMirrorAtThePreReadyCheckLogsTheQueryThatFired() {
        let h = Harness()
        h.backend.mirroredSerials = [42]
        h.backend.mirrorAppearsAtCheck = MirrorSettlePoll.checks + 1
        h.ctrl.begin()
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.logs(level: "warn").contains {
            $0.contains("0x0000002a") && $0.contains("before ready") && $0.contains(h.backend.mirrorWhy)
        })
    }

    @Test func aMirrorPastTheCutoffLogsTheQueryThatFired() {
        let h = Harness()
        h.backend.mirroredSerials = [42]
        h.backend.mirrorAppearsAtCheck = MirrorSettlePoll.checks + 1
        h.ctrl.begin()
        h.advance(SessionController.freshIdentityCutoff + 0.1)
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.logs(level: "warn").contains { $0.contains("before ready") && $0.contains(h.backend.mirrorWhy) })
    }

    @Test func aPreReadyCheckThatCannotTellYetDoesNotDropTheIdentity() {
        let h = Harness()
        h.backend.unknownChecks = MirrorSettlePoll.checks + 1
        h.ctrl.begin()
        h.backend.waitCompletion?(.success(()))
        #expect(h.backend.createSerials == [42])
        #expect(h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: 42, mirroredSkipped: false)))
    }

    // MARK: F-M1 follow-up (review M1/M2/M3) — through the real activation guard; unknown is logged

    @Test func theRun7SequenceThroughTheActivationGuardReachesReadyOnTheFreshIdentity() {
        let h = Harness(freshSerial: 99)
        let off: (online: Int32, mirror: MirrorVerdict) = (0, .notMirrored)
        h.backend.activationScripts = [
            42: [off],                                                     // switched off (10 attempts)
            spare: [(1, .mirrored("CGDisplayIsInMirrorSet(0x000000c3)=1"))],  // restored saved set
            99: [(-1, .unknown), (-1, .unknown), (1, .notMirrored)],      // CG lags, then extended
        ]
        h.ctrl.begin()
        #expect(h.backend.createSerials == [42, spare, 99])
        #expect(h.backend.scriptedAttempts == 3)
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.ended.isEmpty)
        #expect(h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: 99, mirroredSkipped: true)))
        #expect(h.sink.logs(level: "warn").filter { $0.contains("mirror check") }.count == 1)
    }

    @Test func aSwitchedOffIdentityCreatedDuringTheCGLagStillEndsOfflineAndTheChainGoesOn() {
        let h = Harness()
        h.backend.activationScripts = [42: Array(repeating: (-1, .unknown), count: 12) + [(0, .notMirrored)]]
        h.ctrl.begin()
        #expect(h.backend.scriptedAttempts == 12 + ActivationPoll.offlineGiveUpAttempts)
        #expect(h.backend.createSerials == [42, spare])
        #expect(h.sink.logs(level: "warn").contains { $0.contains("switched off") && $0.contains("0x0000002a") })
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: spare, mirroredSkipped: false)))
    }

    @Test func anIdentityUnknownForTheWholeActivationIsDroppedLikeASwitchedOffOne() {
        let h = Harness(freshSerial: 99)
        h.backend.activationScripts = [42: [(-1, .unknown)], spare: [(-1, .unknown)], 99: [(-1, .unknown)]]
        h.ctrl.begin()
        #expect(h.backend.scriptedAttempts == ActivationPoll.maxAttempts)
        #expect(h.backend.createSerials == [42, spare, 99])
        #expect(h.sink.ended == [.ended(.displayOffline, freshTried: true)])
    }

    @Test func unknownSettleChecksAreLoggedOncePerDisplay() {
        let h = Harness()
        h.backend.unknownChecks = 3
        h.ctrl.begin()
        let lines = h.sink.logs(level: "info").filter { $0.contains("cannot tell yet") }
        #expect(lines.count == 1)
        #expect(lines.first?.contains("settle check 1") == true)
        #expect(lines.first?.contains("0x0000002a") == true)
    }

    @Test func eachDisplayGetsItsOwnUnknownLine() {
        let h = Harness()
        h.backend.mirroredSerials = [42]
        h.backend.unknownChecks = 1
        h.ctrl.begin()                                                     // 42: unknown, mirrored → spare: unknown, clear
        #expect(h.backend.createSerials == [42, spare])
        #expect(h.sink.logs(level: "info").filter { $0.contains("cannot tell yet") }.count == 2)
    }

    @Test func anUnknownPreReadyCheckIsLoggedAsCountedClean() {
        let h = Harness()
        h.backend.unknownChecks = MirrorSettlePoll.checks + 1
        h.ctrl.begin()
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.logs(level: "info").contains {
            $0.contains("before ready") && $0.contains("cannot tell yet") && $0.contains("counted as clean")
        })
        #expect(h.sink.events.contains(.ready(displayId: 7, port: 8788, serialNum: 42, mirroredSkipped: false)))
    }

    @Test func theMirrorSettleFitsTheStartBudgetAfterTheLatestFreshIdentity() {
        // Fresh is tried at most `freshIdentityCutoff` after begin; its activation (≤ 3 s) and settle
        // still leave the capturable wait its floor.
        let activation = Double(ActivationPoll.maxAttempts) * ActivationPoll.interval
        #expect(SessionController.freshIdentityCutoff + activation + MirrorSettlePoll.window
                + SessionController.minCapturableTimeout <= SessionController.startBudget)
    }

    // MARK: begin() — the start stays inside one time budget

    @Test func theCapturableWaitIsCutToWhatIsLeftOfTheStartBudget() {
        let h = Harness(freshSerial: 99)
        bothKnownOffline(h, primaryAfter: 1.5, spareAfter: 1.5)
        h.advance(3.0)                                                   // fresh activation: 6 s since begin
        h.backend.completeApply()
        let left = SessionController.startBudget - 6.0
        #expect(abs((h.backend.waitTimeout ?? 0) - left) < 1e-9)
    }

    @Test func theCapturableWaitNeverDropsBelowItsFloor() {
        let h = Harness()
        h.backend.deferApply = true
        h.ctrl.begin()
        h.advance(SessionController.startBudget)                         // a pathological activation
        h.backend.completeApply()
        #expect(h.backend.waitTimeout == SessionController.minCapturableTimeout)
    }

    @Test func aNormalStartKeepsTheFullCapturableWait() {
        let h = Harness()
        h.backend.deferApply = true
        h.ctrl.begin()
        h.advance(2.9)                                                   // slow but normal activation
        h.backend.completeApply()
        #expect(h.backend.waitTimeout == SessionController.capturableTimeout)
    }

    @Test func initialActivationFailureWhileTheMacSleepsEndsMacAsleep() {
        let h = Harness()
        h.backend.deferApply = true
        h.backend.mainAsleep = true
        h.ctrl.begin()
        h.backend.completeApply(.failure(BackendError.displayOffline))
        #expect(h.sink.ended == [.ended(.macAsleep)])
        #expect(h.backend.destroyCalls == 1)
    }

    @Test func otherInitialActivationFailuresStayUnsupportedWhileAwake() {
        let h = Harness()
        h.backend.deferApply = true
        h.ctrl.begin()
        h.backend.completeApply(.failure(BackendError.unsupported))
        #expect(h.sink.ended == [.ended(.unsupported)])
    }

    @Test func createDisplayThrowWhileTheMacSleepsEndsMacAsleep() {
        let h = Harness()
        h.backend.mainAsleep = true
        h.backend.createError = BackendError.unsupported
        h.ctrl.begin()
        #expect(h.sink.ended == [.ended(.macAsleep)])
        #expect(h.backend.destroyCalls == 0)
    }

    @Test func aSleepingMacDoesNotBlockASessionThatStarts() {
        // Sleep only explains a failure; it never pre-empts a display that comes up fine.
        let h = Harness()
        h.backend.mainAsleep = true
        h.ctrl.begin()
        h.backend.waitCompletion?(.success(()))
        #expect(h.sink.events == [.ready(displayId: 7, port: 8788, serialNum: 42)])
        #expect(h.backend.mainAsleepCalls == 0)
    }

    @Test func displayOfflineMapsToItsOwnReason() {
        #expect(SessionController.endReason(for: BackendError.displayOffline) == .displayOffline)
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
        #expect(h.sink.events == [.ready(displayId: 7, port: 8788, serialNum: 42), .connected])
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

    @Test func resizeWithOutOfRangeSizeIsDropped() {
        let h = Harness()
        let (c, id) = h.authed()
        var debug: [String] = []
        h.ctrl.debugLog = { debug.append($0) }
        let calls = h.backend.log.count
        h.ctrl.receive(resizeFrame(w: 0, h: 2340), on: id)
        h.ctrl.receive(resizeFrame(w: 1080, h: 9000), on: id)
        h.advance(0.5)
        h.ctrl.tick()
        #expect(h.ctrl.endedReason == nil)
        #expect(!c.closed)
        #expect(h.backend.log.count == calls)
        #expect(debug.count == 2)
        #expect(h.sink.logs(level: "warn").isEmpty)
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
        #expect(h.sink.events.last == .ready(displayId: 7, port: 8788, serialNum: 42))
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

    // MARK: switched off mid-session (display-offline, not capture-failed)

    @Test func aCaptureFailureOnADisplaySwitchedOffEndsDisplayOffline() {
        let h = Harness()
        let (c, _) = h.authed()
        h.backend.online = false
        h.ctrl.captureError(BackendError.captureFailed("stream stopped"))
        #expect(h.ctrl.endedReason == .displayOffline)
        #expect(c.json.contains { $0["t"] as? String == "end" && $0["reason"] as? String == "display-offline" })
        #expect(h.sink.logs(level: "warn").contains { $0.contains("switched off") })
    }

    // I1: main burns the identity on display-offline, so sleep/lock must never report it.
    @Test func aCaptureFailureOnAnOfflineDisplayWhileTheMacSleepsEndsMacAsleep() {
        let h = Harness()
        let (c, _) = h.authed()
        h.backend.online = false
        h.backend.mainAsleep = true
        h.ctrl.captureError(BackendError.captureFailed("stream stopped"))
        #expect(h.ctrl.endedReason == .macAsleep)
        #expect(h.sink.ended == [.ended(.macAsleep)])
        #expect(c.json.contains { $0["t"] as? String == "end" && $0["reason"] as? String == "mac-asleep" })
    }

    @Test func aReconfigurationToOfflineWhileTheMacSleepsEndsMacAsleep() {
        let h = Harness()
        _ = h.authed()
        h.backend.online = false
        h.backend.mainAsleep = true
        h.ctrl.displayReconfigured()
        #expect(h.ctrl.endedReason == .macAsleep)
        #expect(h.backend.destroyCalls == 1)
    }

    @Test func aCaptureFailureOnAnOnlineDisplayStaysCaptureFailed() {
        let h = Harness()
        _ = h.authed()
        h.ctrl.captureError(BackendError.captureFailed("stream stopped"))
        #expect(h.ctrl.endedReason == .captureFailed)
    }

    @Test func revokedScreenRecordingWinsOverAnOfflineDisplay() {
        let h = Harness()
        _ = h.authed()
        h.backend.online = false
        h.ctrl.captureError(BackendError.permissionDenied)
        #expect(h.ctrl.endedReason == .permissionScreenRecording)
    }

    @Test func aReconfigurationThatSwitchesTheDisplayOffEndsDisplayOffline() {
        let h = Harness()
        _ = h.authed()
        h.backend.online = false
        h.ctrl.displayReconfigured()
        #expect(h.ctrl.endedReason == .displayOffline)
        #expect(h.backend.destroyCalls == 1)
    }

    @Test func aDisplaySwitchedOffWhilePausedEndsDisplayOffline() {
        let h = Harness()
        let (_, id) = h.authed()
        h.ctrl.receive(jsonFrame(#"{"t":"pause"}"#), on: id)
        h.backend.online = false
        h.ctrl.displayReconfigured()
        #expect(h.ctrl.endedReason == .displayOffline)
    }

    @Test func aDisplaySwitchedOffAfterReadyBeforeHelloEndsDisplayOffline() {
        let h = Harness().ready()
        h.backend.online = false
        h.ctrl.displayReconfigured()
        #expect(h.ctrl.endedReason == .displayOffline)
    }

    @Test func anOfflineReconfigurationBeforeReadyLeavesEscalationToActivation() {
        // During the start the offline state is ActivationPoll's call (it escalates identities).
        let h = Harness()
        h.backend.deferApply = true
        h.ctrl.begin()
        h.backend.online = false
        h.ctrl.displayReconfigured()
        #expect(h.ctrl.endedReason == nil)
        h.backend.completeApply(.failure(BackendError.displayOffline))
        #expect(h.backend.createCalls == 2)
    }

    // MARK: "Entire Screen" picked mid-session: respected, never ends the session or burns the identity

    @Test func aMirrorPickedMidSessionKeepsStreaming() {
        let h = Harness()
        _ = h.authed()
        let starts = h.backend.startCalls.count
        h.backend.mirrored = true
        h.ctrl.displayReconfigured()
        #expect(h.ctrl.endedReason == nil)
        #expect(h.sink.ended.isEmpty)
        #expect(h.backend.destroyCalls == 0)
        #expect(h.backend.startCalls.count == starts + 1)   // capture restarted on the mirrored desktop
        h.ctrl.displayReconfigured()
        #expect(h.ctrl.endedReason == nil)
        #expect(h.sink.logs(level: "info").filter { $0.contains("mirror") }.count == 1)
        #expect(h.sink.logs(level: "info").contains { $0.contains("mirror") && $0.contains(h.backend.mirrorWhy) })
        #expect(!h.sink.logs(level: "warn").contains { $0.contains("mirror") })
    }

    @Test func aMirrorPickedAfterReadyBeforeHelloKeepsTheSession() {
        let h = Harness().ready()
        h.backend.mirrored = true
        h.ctrl.displayReconfigured()
        #expect(h.ctrl.endedReason == nil)
        let (c, _) = h.connect(helloFrame())
        #expect(c.jsonTypes.contains("helloAck"))
    }

    @Test func aCaptureFailureOnAMirroredOnlineDisplayIsNotDisplayOffline() {
        // Only a switched-off display burns the identity; a mirror never does.
        let h = Harness()
        _ = h.authed()
        h.backend.mirrored = true
        h.ctrl.captureError(BackendError.captureFailed("stream stopped"))
        #expect(h.ctrl.endedReason == .captureFailed)
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

    // MARK: input, trackpad and teardown (Task 4.3)

    @Test func stopInvokesTeardownBeforeDestroyingTheDisplay() {
        let h = Harness()
        _ = h.authed()
        var teardowns = 0
        h.ctrl.onTeardown = {
            teardowns += 1
            h.backend.log.append("teardown")
        }
        h.ctrl.stop(.stopRequested)
        h.ctrl.stop(.watchdog)
        #expect(teardowns == 1)
        let order = h.backend.log.filter { ["teardown", "destroyDisplay"].contains($0) }
        #expect(order == ["teardown", "destroyDisplay"])
    }

    @Test func everyEndPathInvokesTeardownOnceBeforeDestroy() {
        let paths: [(String, (Harness, ConnectionID) -> Void)] = [
            ("captureError", { h, _ in h.ctrl.captureError(BackendError.captureFailed("x")) }),
            ("bye", { h, id in h.ctrl.receive(jsonFrame(#"{"t":"bye","reason":"user-exit"}"#), on: id) }),
            ("watchdog", { h, _ in h.advance(2.01); h.ctrl.tick() }),
            ("closed", { h, id in h.ctrl.closed(id) }),
            ("parentExit", { h, _ in h.ctrl.stop(.parentExit) }),
        ]
        for (name, end) in paths {
            let h = Harness()
            let (_, id) = h.authed()
            var teardowns = 0
            h.ctrl.onTeardown = {
                teardowns += 1
                h.backend.log.append("teardown")
            }
            end(h, id)
            h.ctrl.stop(.stopRequested)
            #expect(h.ctrl.endedReason != nil, "\(name)")
            #expect(teardowns == 1, "\(name)")
            let order = h.backend.log.filter { ["teardown", "destroyDisplay"].contains($0) }
            #expect(order == ["teardown", "destroyDisplay"], "\(name)")
        }
    }

    @Test func authenticatedInputReachesOnInput() {
        let h = Harness()
        let (_, id) = h.authed()
        var got: [InputEvent] = []
        h.ctrl.onInput = { got.append($0) }
        h.ctrl.receive(jsonFrame(#"{"t":"input","e":"click","x":0.25,"y":0.75}"#), on: id)
        h.ctrl.receive(jsonFrame(#"{"t":"input","e":"move","dx":0.01,"dy":-0.02}"#), on: id)
        #expect(got.count == 2)
        #expect(got.first?.kind == .click)
        #expect(got.first?.x == 0.25)
        #expect(got.last?.kind == .move)
        #expect(h.sink.logs(level: "info").isEmpty)
    }

    @Test func dropsInputWhenPostEventAccessIsMissing() {
        let h = Harness()
        h.backend.postEvent = false
        let (c, id) = h.authed()
        var got = 0
        h.ctrl.onInput = { _ in got += 1 }
        h.ctrl.receive(jsonFrame(#"{"t":"input","e":"click","x":0.5,"y":0.5}"#), on: id)
        h.ctrl.receive(jsonFrame(#"{"t":"input","e":"click","x":0.5,"y":0.5}"#), on: id)
        #expect(got == 0)
        #expect(h.ctrl.endedReason == nil)
        #expect(!c.closed)
        #expect(h.sink.logs.count == 1)   // logged once, not per event
    }

    // MARK: Accessibility (PostEvent) re-check mid-session

    /// Keeps the watchdog fed while the clock moves `seconds` forward, then ticks.
    private func live(_ h: Harness, _ id: ConnectionID, seconds: TimeInterval) {
        var left = seconds
        while left > 0 {
            let step = min(1.0, left)
            h.advance(step)
            h.ctrl.receive(jsonFrame(#"{"t":"keepalive"}"#), on: id)
            left -= step
        }
        h.ctrl.tick()
    }

    private func inputStates(_ c: FakeConnection) -> [Bool] {
        c.json.filter { $0["t"] as? String == "inputState" }.compactMap { $0["inputEnabled"] as? Bool }
    }

    @Test func readyReportsMissingPostEventAccess() {
        let h = Harness()
        h.backend.postEvent = false
        h.ready()
        #expect(h.sink.events.first == .ready(displayId: 7, port: 8788, serialNum: 42, postEventMissing: true))
    }

    @Test func readyOmitsPostEventWhenGranted() {
        let h = Harness().ready()
        #expect(h.sink.events.first == .ready(displayId: 7, port: 8788, serialNum: 42, postEventMissing: false))
    }

    @Test func grantMidSessionTurnsInputOnAndTellsThePhone() {
        let h = Harness()
        h.backend.postEvent = false
        let (c, id) = h.authed()
        var got = 0
        h.ctrl.onInput = { _ in got += 1 }
        h.backend.postEvent = true
        live(h, id, seconds: 1)
        #expect(inputStates(c).isEmpty)   // not re-checked before the interval
        live(h, id, seconds: 1)
        #expect(inputStates(c) == [true])
        h.ctrl.receive(jsonFrame(#"{"t":"input","e":"click","x":0.5,"y":0.5}"#), on: id)
        #expect(got == 1)
        #expect(h.sink.logs(level: "info").contains { $0.contains("touch input is on") })
        #expect(h.ctrl.endedReason == nil)
    }

    @Test func revokeMidSessionTurnsInputOffAndTellsThePhone() {
        let h = Harness()
        let (c, id) = h.authed()
        var got = 0
        h.ctrl.onInput = { _ in got += 1 }
        h.backend.postEvent = false
        live(h, id, seconds: 2)
        #expect(inputStates(c) == [false])
        h.ctrl.receive(jsonFrame(#"{"t":"input","e":"click","x":0.5,"y":0.5}"#), on: id)
        #expect(got == 0)
        #expect(h.sink.logs(level: "warn").contains { $0.contains("touch input is off") })
    }

    @Test func unchangedAccessSendsNothing() {
        let h = Harness()
        h.backend.postEvent = false
        let (c, id) = h.authed()
        live(h, id, seconds: 6)
        #expect(inputStates(c).isEmpty)
        #expect(c.jsonTypes.filter { $0 == "inputState" }.isEmpty)
    }

    @Test func grantRevokeGrantSendsEachChangeOnce() {
        let h = Harness()
        h.backend.postEvent = false
        let (c, id) = h.authed()
        h.backend.postEvent = true
        live(h, id, seconds: 2)
        live(h, id, seconds: 2)
        h.backend.postEvent = false
        live(h, id, seconds: 2)
        h.backend.postEvent = true
        live(h, id, seconds: 2)
        #expect(inputStates(c) == [true, false, true])
    }

    @Test func inputStateEncodesItsFlag() throws {
        let data = try JSONEncoder().encode(HelperMessage.inputState(inputEnabled: true))
        let obj = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(obj["t"] as? String == "inputState")
        #expect(obj["inputEnabled"] as? Bool == true)
    }

    @Test func inputAfterTheSessionEndedIsDropped() {
        let h = Harness()
        let (_, id) = h.authed()
        var got = 0
        h.ctrl.onInput = { _ in got += 1 }
        // bye and an input in the same read: the input after the end is never delivered.
        var both = jsonFrame(#"{"t":"bye","reason":"user-exit"}"#)
        both.append(jsonFrame(#"{"t":"input","e":"click","x":0.5,"y":0.5}"#))
        h.ctrl.receive(both, on: id)
        h.ctrl.receive(jsonFrame(#"{"t":"input","e":"click","x":0.5,"y":0.5}"#), on: id)
        #expect(got == 0)
        #expect(h.ctrl.endedReason == .phoneBye)
    }

    @Test func setTrackpadTogglesTheCapturedCursor() {
        let h = Harness()
        let (_, id) = h.authed()
        h.ctrl.receive(jsonFrame(#"{"t":"setTrackpad","enabled":true}"#), on: id)
        #expect(h.backend.cursorCalls == [true])
        // A capture restart keeps the toggled cursor.
        h.ctrl.receive(jsonFrame(#"{"t":"pause"}"#), on: id)
        h.ctrl.receive(jsonFrame(#"{"t":"resume"}"#), on: id)
        #expect(h.backend.startCalls.last?.cursor == true)
        h.ctrl.receive(jsonFrame(#"{"t":"setTrackpad","enabled":false}"#), on: id)
        #expect(h.backend.cursorCalls == [true, false])
        #expect(h.sink.logs.isEmpty)
    }

    @Test func reconfigurationUpdatesInputBounds() {
        let h = Harness()
        _ = h.authed()
        var bounds: [CGRect] = []
        h.ctrl.onBoundsChanged = { bounds.append($0) }
        let starts = h.backend.startCalls.count
        let keyframes = h.backend.forceKeyframeCalls
        h.backend.bounds = CGRect(x: 0, y: -432, width: 1170, height: 540)
        h.ctrl.displayReconfigured()
        #expect(bounds == [CGRect(x: 0, y: -432, width: 1170, height: 540)])
        #expect(h.backend.startCalls.count == starts + 1)
        #expect(h.backend.startCalls.last?.w == 2340)
        #expect(h.backend.startCalls.last?.h == 1080)
        #expect(h.backend.forceKeyframeCalls == keyframes + 1)
        #expect(h.ctrl.endedReason == nil)
    }

    @Test func reconfigurationBeforeHelloOnlyReportsBounds() {
        let h = Harness().ready()
        var bounds: [CGRect] = []
        h.ctrl.onBoundsChanged = { bounds.append($0) }
        h.ctrl.displayReconfigured()
        #expect(bounds.count == 1)
        #expect(h.backend.startCalls.isEmpty)
        #expect(h.backend.forceKeyframeCalls == 0)
    }

    @Test func reconfigurationWhilePausedDoesNotRestartCapture() {
        let h = Harness()
        let (_, id) = h.authed()
        h.ctrl.receive(jsonFrame(#"{"t":"pause"}"#), on: id)
        var bounds = 0
        h.ctrl.onBoundsChanged = { _ in bounds += 1 }
        h.ctrl.displayReconfigured()
        #expect(bounds == 1)
        #expect(h.backend.startCalls.count == 1)
    }

    @Test func reconfigurationAfterTheEndIsIgnored() {
        let h = Harness()
        _ = h.authed()
        h.ctrl.stop(.stopRequested)
        var bounds = 0
        h.ctrl.onBoundsChanged = { _ in bounds += 1 }
        h.ctrl.displayReconfigured()
        #expect(bounds == 0)
        #expect(h.backend.startCalls.count == 1)
    }

    @Test func implicitHelloResizeReportsBounds() {
        let h = Harness().ready()
        var bounds: [CGRect] = []
        h.ctrl.onBoundsChanged = { bounds.append($0) }
        h.backend.deferApply = true
        h.connect(helloFrame(w: 1080, h: 2340, orientation: "portrait"))
        #expect(bounds.isEmpty)   // not until the new mode is active
        h.backend.widthPoints = 432
        h.backend.completeApply()
        #expect(bounds == [CGRect(x: 0, y: 0, width: 432, height: 432)])
    }

    @Test func helloAtTheStartSizeDoesNotReportBounds() {
        let h = Harness().ready()
        var bounds = 0
        h.ctrl.onBoundsChanged = { _ in bounds += 1 }
        h.connect(helloFrame())
        #expect(bounds == 0)
    }

    // MARK: rotation renegotiation (Task 4.5)

    /// Portrait session (start + hello at 1080x2340), streaming.
    private func portraitSession() -> (Harness, FakeConnection, ConnectionID) {
        let h = Harness(w: 1080, h: 2340)
        h.backend.widthPoints = 432   // 1080 / 2.5
        h.ready()
        let (c, id) = h.connect(helloFrame(w: 1080, h: 2340, orientation: "portrait"))
        return (h, c, id)
    }

    @Test func coalescesResizesWithin300ms() {
        let (h, _, id) = portraitSession()
        #expect(h.backend.applied.count == 1)   // begin()
        h.ctrl.receive(resizeFrame(w: 1080, h: 2340), on: id)
        h.advance(0.1)
        h.ctrl.receive(resizeFrame(w: 2340, h: 1080), on: id)
        h.advance(0.25)
        h.ctrl.tick()
        #expect(h.backend.applied.count == 1)   // 250 ms after the last one: still waiting
        h.advance(0.1)
        h.ctrl.tick()
        #expect(h.backend.applied.count == 2)
        #expect(h.backend.applied.last == DisplayModes.modes(surfaceW: 2340, surfaceH: 1080, preferredDivisor: 2.5))
        h.advance(1)
        h.ctrl.tick()
        #expect(h.backend.applied.count == 2)   // applied once
    }

    @Test func resizeKeepsTheUsersChosenScale() {
        let h = Harness()
        let (_, id) = h.authed()
        h.backend.widthPoints = 1170   // the user picked the 2.0 (pixel-exact) mode on the 2340 surface
        h.ctrl.receive(resizeFrame(w: 1080, h: 2340), on: id)
        h.advance(0.35)
        h.ctrl.tick()
        #expect(h.backend.applied.last?.first == ModeSpec(widthPoints: 540, heightPoints: 1170))
        #expect(h.backend.applied.last == DisplayModes.modes(surfaceW: 1080, surfaceH: 2340, preferredDivisor: 2.0))
    }

    /// F2 (device run 4): macOS restores 2260x1080@2x (the 1.0 spec's HiDPI variant) in landscape for
    /// this identity. The preferred 2.0 mode (1130x540) is usable, so it must be activated, and the
    /// return to portrait must derive divisor 2.0 again, not 1.0.
    @Test func rotationKeepsThePreferredHiDPIScaleWhenMacOSRestoresAnotherAppliedMode() {
        let h = Harness(w: 1080, h: 2260)
        h.backend.macOS = SimulatedMacOSModes(remembered: [
            false: SimulatedMacOSModes.hiDPI(540, 1130),
            true: SimulatedMacOSModes.hiDPI(2260, 1080),
        ])
        h.ready()
        let (_, id) = h.connect(helloFrame(w: 1080, h: 2260, orientation: "portrait"))
        // Portrait: 2.5 (432x904) and 3.0 (360x752) are unusable, so 2.0 (540x1130) is the choice.
        #expect(h.backend.macOS?.active == SimulatedMacOSModes.hiDPI(540, 1130))

        h.ctrl.receive(resizeFrame(w: 2260, h: 1080), on: id)
        h.advance(0.35)
        h.ctrl.tick()
        #expect(h.backend.applied.last?.first == ModeSpec(widthPoints: 1130, heightPoints: 540))
        #expect(h.backend.macOS?.active == SimulatedMacOSModes.hiDPI(1130, 540))

        h.ctrl.receive(resizeFrame(w: 1080, h: 2260), on: id)
        h.advance(0.35)
        h.ctrl.tick()
        #expect(h.backend.applied.last == DisplayModes.modes(surfaceW: 1080, surfaceH: 2260, preferredDivisor: 2.0))
        #expect(h.backend.macOS?.active == SimulatedMacOSModes.hiDPI(540, 1130))

        h.ctrl.receive(resizeFrame(w: 2260, h: 1080), on: id)
        h.advance(0.35)
        h.ctrl.tick()
        #expect(h.backend.applied.last == DisplayModes.modes(surfaceW: 2260, surfaceH: 1080, preferredDivisor: 2.0))
        #expect(h.backend.macOS?.active == SimulatedMacOSModes.hiDPI(1130, 540))
    }

    @Test func resizeRestartsCaptureWithAnIDR() {
        let h = Harness()
        let (c, id) = h.authed()
        h.ctrl.parameterSets(annexB: Data([0, 0, 0, 1, 0x67]), width: 2340, height: 1080)
        h.encode(3)
        h.backend.log.removeAll()
        h.ctrl.receive(resizeFrame(w: 1080, h: 2340), on: id)
        h.advance(0.35)
        h.ctrl.tick()
        #expect(h.backend.log == ["stopCapture", "applyModes", "refreshCaptureTarget", "startCapture", "forceKeyframe"])
        #expect(h.backend.startCalls.last?.w == 1080)
        #expect(h.backend.startCalls.last?.h == 2340)
        // Flow control: window cleared (3 unacked frames no longer block), seq continues.
        #expect(h.ctrl.shouldEncodeNextFrame())
        h.ctrl.parameterSets(annexB: Data([0, 0, 0, 1, 0x67]), width: 1080, height: 2340)
        h.encode(1)
        #expect(c.videoFrames.last?.seq == 4)
        let configs = c.json.filter { $0["t"] as? String == "streamConfig" }
        #expect(configs.last?["w"] as? Int == 1080)
        #expect(configs.last?["h"] as? Int == 2340)
        // streamConfig is the frame right before the new config frame.
        let frames = c.frames
        if let cfg = frames.lastIndex(where: { if case .video(let f, _, _) = $0 { return f.contains(.config) } else { return false } }) {
            if case .json(let body) = frames[cfg - 1] {
                #expect(String(decoding: body, as: UTF8.self).contains("streamConfig"))
            } else { Issue.record("no streamConfig before the config frame") }
        } else { Issue.record("no config frame") }
    }

    @Test func resizeReportsBoundsOnlyAfterTheModeIsActiveThenStartsCapture() {
        let h = Harness()
        let (c, id) = h.authed()
        var order: [String] = []
        h.ctrl.onBoundsChanged = { _ in order.append("bounds:\(h.backend.startCalls.count)") }
        h.backend.deferApply = true
        h.ctrl.receive(resizeFrame(w: 1080, h: 2340), on: id)
        h.advance(0.35)
        h.ctrl.tick()
        #expect(h.backend.pendingApplies.count == 1)
        #expect(order.isEmpty)
        // The session queue is never blocked meanwhile: keepalives flow and the watchdog is fed.
        for _ in 0..<5 {
            h.advance(0.5)
            h.ctrl.receive(jsonFrame(#"{"t":"keepalive"}"#), on: id)
            h.ctrl.tick()
        }
        #expect(h.ctrl.endedReason == nil)
        #expect(c.jsonTypes.filter { $0 == "keepalive" }.count >= 2)
        #expect(h.backend.startCalls.count == 1)
        h.backend.completeApply()
        #expect(order == ["bounds:1"])   // bounds first, then capture
        #expect(h.backend.startCalls.count == 2)
        #expect(h.backend.startCalls.last?.w == 1080)
    }

    @Test func resizeEqualToTheCurrentSurfaceIsIgnored() {
        let h = Harness()
        let (_, id) = h.authed()
        let calls = h.backend.log.count
        h.ctrl.receive(resizeFrame(w: 2340, h: 1080), on: id)
        h.advance(0.5)
        h.ctrl.tick()
        #expect(h.backend.log.count == calls)
    }

    @Test func resizeThereAndBackWithinTheWindowDoesNothing() {
        let h = Harness()
        let (_, id) = h.authed()
        let calls = h.backend.log.count
        h.ctrl.receive(resizeFrame(w: 1080, h: 2340), on: id)
        h.advance(0.1)
        h.ctrl.receive(resizeFrame(w: 2340, h: 1080), on: id)
        h.advance(0.5)
        h.ctrl.tick()
        #expect(h.backend.log.count == calls)
    }

    @Test func resizeDuringTheHelloActivationIsAppliedOnceItLands() {
        let (h, _, id) = resizingSession()   // hello 1080x2340 on a 2340x1080 display, activation in flight
        h.ctrl.receive(resizeFrame(w: 2340, h: 1080), on: id)
        h.advance(0.5)
        h.ctrl.tick()
        #expect(h.backend.applied.count == 2)   // begin + hello: the resize waits
        h.backend.widthPoints = 432   // macOS activated the portrait 2.5 mode
        h.backend.completeApply()
        #expect(h.backend.startCalls.count == 1)
        h.ctrl.tick()
        #expect(h.backend.applied.count == 3)
        #expect(h.backend.applied.last == DisplayModes.modes(surfaceW: 2340, surfaceH: 1080, preferredDivisor: 2.5))
        h.backend.completeApply()
        #expect(h.backend.startCalls.last?.w == 2340)
        #expect(h.backend.startCalls.last?.h == 1080)
    }

    @Test func resizesDuringAnInFlightResizeActivationAreCoalescedAfterIt() {
        let h = Harness()
        let (_, id) = h.authed()
        h.backend.deferApply = true
        h.ctrl.receive(resizeFrame(w: 1080, h: 2340), on: id)
        h.advance(0.35)
        h.ctrl.tick()
        #expect(h.backend.applied.count == 2)
        h.ctrl.receive(resizeFrame(w: 2340, h: 1080), on: id)
        h.advance(0.1)
        h.ctrl.receive(resizeFrame(w: 1200, h: 2600), on: id)
        h.advance(0.5)
        h.ctrl.tick()
        #expect(h.backend.applied.count == 2)   // never two activations at once
        h.backend.widthPoints = 432   // macOS activated the portrait 2.5 mode
        h.backend.completeApply()
        h.ctrl.tick()
        #expect(h.backend.applied.count == 3)
        #expect(h.backend.applied.last?.first == DisplayModes.modes(surfaceW: 1200, surfaceH: 2600).first)
        h.backend.completeApply()
        #expect(h.backend.startCalls.map { $0.w } == [2340, 1080, 1200])
    }

    @Test func reconfigurationDuringOurResizeDoesNotStartASecondCapture() {
        let h = Harness()
        let (_, id) = h.authed()
        h.backend.deferApply = true
        h.ctrl.receive(resizeFrame(w: 1080, h: 2340), on: id)
        h.advance(0.35)
        h.ctrl.tick()
        h.ctrl.displayReconfigured()   // our own mode change, observed mid-activation
        #expect(h.backend.startCalls.count == 1)
        h.backend.completeApply()
        #expect(h.backend.startCalls.count == 2)
        #expect(h.backend.startCalls.last?.w == 1080)
    }

    @Test func theReconfigurationEchoOfOurResizeReportsBoundsWithoutASecondRestart() {
        let h = Harness()
        let (_, id) = h.authed()
        var bounds = 0
        h.ctrl.onBoundsChanged = { _ in bounds += 1 }
        h.ctrl.receive(resizeFrame(w: 1080, h: 2340), on: id)
        h.advance(0.35)
        h.ctrl.tick()
        #expect(h.backend.startCalls.count == 2)
        #expect(bounds == 1)
        h.advance(0.1)
        h.ctrl.displayReconfigured()   // the echo of our own mode change
        #expect(bounds == 2)
        #expect(h.backend.startCalls.count == 2)
        h.advance(1)
        h.ctrl.displayReconfigured()   // a later change (the user picked another scale): restart
        #expect(bounds == 3)
        #expect(h.backend.startCalls.count == 3)
        #expect(h.backend.startCalls.last?.w == 1080)
    }

    @Test func resizeWhilePausedAppliesTheModeAndStartsCaptureOnResume() {
        let h = Harness()
        let (_, id) = h.authed()
        h.ctrl.receive(jsonFrame(#"{"t":"pause"}"#), on: id)
        h.ctrl.receive(resizeFrame(w: 1080, h: 2340), on: id)
        h.advance(0.35)
        h.ctrl.tick()
        #expect(h.backend.applied.count == 2)
        #expect(h.backend.startCalls.count == 1)   // still paused
        h.ctrl.receive(jsonFrame(#"{"t":"resume"}"#), on: id)
        #expect(h.backend.startCalls.count == 2)
        #expect(h.backend.startCalls.last?.w == 1080)
    }

    /// M4: a failed rotation activation keeps the old mode instead of ending the session.
    @Test func resizeActivationFailureKeepsTheOldModeAndSession() {
        let h = Harness()
        let (c, id) = h.authed()
        var bounds: [CGRect] = []
        h.ctrl.onBoundsChanged = { bounds.append($0) }
        h.backend.log.removeAll()
        let keyframes = h.backend.forceKeyframeCalls
        h.backend.applyError = BackendError.captureFailed("mode")
        h.ctrl.receive(resizeFrame(w: 1080, h: 2340), on: id)
        h.advance(0.35)
        h.ctrl.tick()
        #expect(h.ctrl.endedReason == nil)
        #expect(h.backend.destroyCalls == 0)
        #expect(!c.jsonTypes.contains("end"))
        #expect(h.sink.logs(level: "warn").contains { $0.contains("keeping 2340x1080") })
        #expect(h.sink.logs(level: "error").isEmpty)
        #expect(h.backend.log == ["stopCapture", "applyModes", "refreshCaptureTarget", "startCapture", "forceKeyframe"])
        #expect(h.backend.startCalls.last?.w == 2340)
        #expect(h.backend.startCalls.last?.h == 1080)
        #expect(h.backend.forceKeyframeCalls == keyframes + 1)
        #expect(bounds.count == 1)
        // `surface` is the old size again: a resize back to it is a no-op, a retry renegotiates.
        h.backend.applyError = nil
        h.ctrl.receive(resizeFrame(w: 2340, h: 1080), on: id)
        h.advance(0.35)
        h.ctrl.tick()
        #expect(h.backend.applied.count == 2)
        h.ctrl.receive(resizeFrame(w: 1080, h: 2340), on: id)
        h.advance(0.35)
        h.ctrl.tick()
        #expect(h.backend.applied.count == 3)
        #expect(h.backend.startCalls.last?.w == 1080)
    }

    @Test func resizeActivationFailureWhilePausedResumesAtTheOldSize() {
        let h = Harness()
        let (_, id) = h.authed()
        h.ctrl.receive(jsonFrame(#"{"t":"pause"}"#), on: id)
        h.backend.applyError = BackendError.unsupported
        h.ctrl.receive(resizeFrame(w: 1080, h: 2340), on: id)
        h.advance(0.35)
        h.ctrl.tick()
        #expect(h.ctrl.endedReason == nil)
        #expect(h.backend.startCalls.count == 1)   // still paused
        h.ctrl.receive(jsonFrame(#"{"t":"resume"}"#), on: id)
        #expect(h.backend.startCalls.count == 2)
        #expect(h.backend.startCalls.last?.w == 2340)
    }

    @Test func pendingResizeIsDroppedWhenTheSessionEnds() {
        let h = Harness()
        let (_, id) = h.authed()
        h.ctrl.receive(resizeFrame(w: 1080, h: 2340), on: id)
        h.ctrl.stop(.stopRequested)
        let calls = h.backend.log.count
        h.advance(0.5)
        h.ctrl.tick()
        #expect(h.backend.log.count == calls)
    }

    // MARK: fix round 1 — fresh capture target after a mode change; release a held button on resize

    @Test func helloAtTheStartSizeDoesNotRefreshTheCaptureTarget() {
        let h = Harness()
        _ = h.authed()
        #expect(h.backend.refreshCalls == 0)   // waitUntilCapturable's snapshot is current
    }

    @Test func implicitHelloResizeRefreshesTheCaptureTargetBeforeStarting() {
        let h = Harness().ready()
        h.connect(helloFrame(w: 1080, h: 2340, orientation: "portrait"))
        let order = h.backend.log.filter { ["applyModes", "refreshCaptureTarget", "startCapture"].contains($0) }
        #expect(order == ["applyModes", "applyModes", "refreshCaptureTarget", "startCapture"])
    }

    @Test func resizeWaitsForTheRefreshedCaptureTargetWithoutBlocking() {
        let h = Harness()
        let (c, id) = h.authed()
        h.backend.deferRefresh = true
        h.ctrl.receive(resizeFrame(w: 1080, h: 2340), on: id)
        h.advance(0.35)
        h.ctrl.tick()
        #expect(h.backend.pendingRefreshes.count == 1)
        #expect(h.backend.startCalls.count == 1)
        h.advance(1)
        h.ctrl.receive(jsonFrame(#"{"t":"keepalive"}"#), on: id)
        h.ctrl.tick()
        #expect(c.jsonTypes.contains("keepalive"))
        // A resize meanwhile waits for this restart (never two in flight).
        h.ctrl.receive(resizeFrame(w: 2340, h: 1080), on: id)
        h.advance(0.5)
        h.ctrl.tick()
        #expect(h.backend.applied.count == 2)
        h.backend.completeRefresh()
        #expect(h.backend.startCalls.count == 2)
        #expect(h.backend.startCalls.last?.w == 1080)
    }

    @Test func reconfigurationRestartRefreshesTheCaptureTarget() {
        let h = Harness()
        _ = h.authed()
        h.backend.log.removeAll()
        h.ctrl.displayReconfigured()
        #expect(h.backend.log == ["stopCapture", "refreshCaptureTarget", "startCapture", "forceKeyframe"])
    }

    @Test func reconfigurationWhilePausedRefreshesOnResume() {
        let h = Harness()
        let (_, id) = h.authed()
        h.ctrl.receive(jsonFrame(#"{"t":"pause"}"#), on: id)
        h.ctrl.displayReconfigured()
        #expect(h.backend.refreshCalls == 0)
        h.ctrl.receive(jsonFrame(#"{"t":"resume"}"#), on: id)
        #expect(h.backend.refreshCalls == 1)
        #expect(h.backend.startCalls.count == 2)
        h.ctrl.receive(jsonFrame(#"{"t":"pause"}"#), on: id)
        h.ctrl.receive(jsonFrame(#"{"t":"resume"}"#), on: id)
        #expect(h.backend.refreshCalls == 1)   // nothing changed since
    }

    @Test func aLateRefreshAfterTheEndIsIgnored() {
        let h = Harness()
        _ = h.authed()
        h.backend.deferRefresh = true
        h.ctrl.displayReconfigured()
        h.ctrl.stop(.stopRequested)
        h.backend.completeRefresh()
        #expect(h.backend.startCalls.count == 1)
    }

    @Test func aRefreshLandingWhilePausedDefersCaptureToResume() {
        let h = Harness()
        let (_, id) = h.authed()
        h.backend.deferRefresh = true
        h.ctrl.displayReconfigured()
        h.ctrl.receive(jsonFrame(#"{"t":"pause"}"#), on: id)
        h.backend.completeRefresh()
        #expect(h.backend.startCalls.count == 1)
        h.ctrl.receive(jsonFrame(#"{"t":"resume"}"#), on: id)
        #expect(h.backend.startCalls.count == 2)
        #expect(h.backend.refreshCalls == 1)
    }

    @Test func pauseAndResumeDuringARefreshStartCaptureOnce() {
        let h = Harness()
        let (_, id) = h.authed()
        h.backend.deferRefresh = true
        h.ctrl.displayReconfigured()
        h.ctrl.receive(jsonFrame(#"{"t":"pause"}"#), on: id)
        h.ctrl.receive(jsonFrame(#"{"t":"resume"}"#), on: id)
        #expect(h.backend.startCalls.count == 1)
        h.backend.completeRefresh()
        #expect(h.backend.startCalls.count == 2)
        #expect(h.backend.pendingRefreshes.isEmpty)
    }

    @Test func applyingAResizeReleasesAHeldButtonBeforeTheBoundsChange() {
        let h = Harness()
        let (_, id) = h.authed()
        var order: [String] = []
        h.ctrl.onResizeApplied = { order.append("release") }
        h.ctrl.onBoundsChanged = { _ in order.append("bounds") }
        h.ctrl.receive(resizeFrame(w: 1080, h: 2340), on: id)
        #expect(order.isEmpty)   // not before it is applied
        h.advance(0.35)
        h.ctrl.tick()
        #expect(order == ["release", "bounds"])
    }

    @Test func anIgnoredResizeReleasesNothing() {
        let h = Harness()
        let (_, id) = h.authed()
        var released = 0
        h.ctrl.onResizeApplied = { released += 1 }
        h.ctrl.receive(resizeFrame(w: 2340, h: 1080), on: id)
        h.advance(0.35)
        h.ctrl.tick()
        #expect(released == 0)
    }

    // MARK: fix round 2 — reconfiguration during the refresh; permission revoked

    @Test func aReconfigurationDuringTheRefreshRefreshesAgainThenStartsOnce() {
        let h = Harness()
        _ = h.authed()
        h.backend.deferRefresh = true
        h.ctrl.displayReconfigured()
        #expect(h.backend.refreshCalls == 1)
        h.ctrl.displayReconfigured()   // the display changed again while we were reading it
        #expect(h.backend.refreshCalls == 1)
        h.backend.completeRefresh()
        #expect(h.backend.refreshCalls == 2)
        #expect(h.backend.startCalls.count == 1)   // not yet: the snapshot may be stale
        h.backend.completeRefresh()
        #expect(h.backend.startCalls.count == 2)
        #expect(h.backend.pendingRefreshes.isEmpty)
    }

    @Test func extraRefreshesAreBoundedThenCaptureStartsWithTheLatestSnapshot() {
        let h = Harness()
        _ = h.authed()
        h.backend.deferRefresh = true
        h.ctrl.displayReconfigured()
        for _ in 0..<3 {
            h.ctrl.displayReconfigured()
            h.backend.completeRefresh()
        }
        #expect(h.backend.refreshCalls == 1 + SessionController.maxExtraTargetRefreshes)
        #expect(h.backend.pendingRefreshes.isEmpty)
        #expect(h.backend.startCalls.count == 2)
        #expect(h.sink.logs(level: "info").contains { $0.contains("latest snapshot") })
    }

    @Test func permissionRevokedDuringTheRefreshEndsWithThePermissionReason() {
        let h = Harness()
        let (c, id) = h.authed()
        h.backend.refreshResult = .failure(.permissionDenied)
        h.ctrl.receive(resizeFrame(w: 1080, h: 2340), on: id)
        h.advance(0.35)
        h.ctrl.tick()
        #expect(h.ctrl.endedReason == .permissionScreenRecording)
        #expect(h.sink.events.last == .ended(.permissionScreenRecording))
        #expect(h.backend.startCalls.count == 1)   // no capture start after the refresh
        #expect(c.jsonTypes.last == "end")
        #expect(h.backend.destroyCalls == 1)
    }

    @Test func aNonPermissionRefreshFailureFallsBackToThePreviousSnapshot() {
        let h = Harness()
        _ = h.authed()
        h.backend.refreshResult = .failure(.captureUnavailable)
        h.ctrl.displayReconfigured()
        #expect(h.ctrl.endedReason == nil)
        #expect(h.backend.startCalls.count == 2)
    }
}
