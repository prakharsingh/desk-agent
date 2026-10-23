import CoreGraphics
import DisplayHelperCore
import Foundation

/// `DisplayBackend` over `VirtualDisplayController` + `CaptureEncoder`.
///
/// Threading: every method is called on the session queue, which is also `encoder`'s queue, so
/// `CaptureEncoder`'s synchronous entry points run inline and its callbacks (wired by `main.swift`)
/// and `waitUntilCapturable` completions arrive on that same queue.
public final class RealDisplayBackend: DisplayBackend {
    public let encoder: CaptureEncoder
    /// Our display was reconfigured (scale change, moved in the arrangement). Delivered on the session
    /// queue, coalesced; wire it to `SessionController.displayReconfigured()`.
    public var onReconfigured: (() -> Void)?
    /// Helper log lines `(level, message)`, delivered on the session queue (main → `HelperEvent.log`).
    public var onLog: ((String, String) -> Void)?
    private let queue: DispatchQueue
    private var display: VirtualDisplayController?
    private let screenCapture: ScreenCaptureAccess
    private var reconfiguration: ReconfigurationObserver?
    private var reconfigurationToken: Unmanaged<ReconfigurationObserver>?

    public init(queue: DispatchQueue, screenCapture: ScreenCaptureAccess = .system) {
        self.queue = queue
        self.screenCapture = screenCapture
        encoder = CaptureEncoder(queue: queue)
    }

    /// Preflight only: `serve` never shows the Screen Recording prompt. Not granted → the session
    /// ends `permission-screen-recording`; prompting is `--request-permissions`' job (Contract C), so
    /// main's needs-relaunch bookkeeping sees every request.
    public func preflightScreenRecording() -> Bool { screenCapture.preflight() }

    public func preflightPostEvent() -> Bool { CGPreflightPostEventAccess() }

    public func mainDisplayAsleep() -> Bool { CGDisplayIsAsleep(CGMainDisplayID()) != 0 }

    public func displayIsOnline() -> Bool { display.map { CGDisplayIsOnline($0.displayId) != 0 } ?? false }

    /// Read-only queries only (no configuration call): ours in a mirror set, or any online display
    /// mirroring ours; `.unknown` while this process does not list our display yet (F-M1).
    public func mirrorVerdict() -> MirrorVerdict {
        display.map { VirtualDisplayController.mirrorVerdict($0.displayId) } ?? .notMirrored
    }

    public func runLater(after delay: TimeInterval, _ work: @escaping () -> Void) {
        queue.asyncAfter(deadline: .now() + delay, execute: work)
    }

    public func createDisplay(maxPixels: Int, sizeInMillimeters: CGSize, serialNum: UInt32,
                              vendorId: UInt32, productId: UInt32) throws -> UInt32 {
        let vd = try VirtualDisplayController(maxPixels: maxPixels, sizeInMillimeters: sizeInMillimeters,
                                              serialNum: serialNum, vendorId: vendorId, productId: productId)
        display = vd
        watchReconfiguration(of: vd.displayId)
        return vd.displayId
    }

    public func waitUntilCapturable(displayId: UInt32, timeout: TimeInterval,
                                    completion: @escaping (Result<Void, BackendError>) -> Void) {
        encoder.waitUntilCapturable(displayId: displayId, timeout: timeout, completion: completion)
    }

    public func startCapture(width: Int, height: Int, showsCursor: Bool) throws {
        guard let display else { throw BackendError.captureUnavailable }
        try encoder.start(displayId: display.displayId, width: width, height: height, showsCursor: showsCursor)
    }

    public func stopCapture() { encoder.stop() }
    public func forceKeyframe() { encoder.forceKeyframe() }
    public func unblocked() { encoder.unblocked() }
    public func setShowsCursor(_ on: Bool) { encoder.setShowsCursor(on) }

    /// Settings now; activation polled off the session queue; `completion` on the session queue.
    public func applyModes(_ modes: [ModeSpec], completion: @escaping (Result<Void, Error>) -> Void) {
        guard let display else { return queue.async { completion(.failure(BackendError.unsupported)) } }
        let displayId = display.displayId
        display.apply(modes: modes, deliverOn: queue, onFirstUnknown: { [weak self] answers in
            self?.onLog?("info", "mode activation cannot tell yet whether display \(String(format: "0x%08x", displayId)) is "
                + "online and unmirrored (\(answers)): CoreGraphics in this process does not list it yet; retrying "
                + "without configuring (logged once per display)")
        }, completion: completion)
    }

    /// How long a capture restart waits for a fresh `SCDisplay` before falling back to the old one.
    static let captureTargetRefreshTimeout: TimeInterval = 1.0

    /// Permission denied when ScreenCaptureKit says `userDeclined` or, after any other failure, when
    /// the Screen Recording preflight is now false (access revoked mid-session).
    public func refreshCaptureTarget(completion: @escaping (Result<Void, BackendError>) -> Void) {
        guard let display else { return queue.async { completion(.success(())) } }
        encoder.refreshDisplay(displayId: display.displayId, timeout: Self.captureTargetRefreshTimeout) { [weak self] result in
            guard let self else { return completion(.success(())) }
            switch result {
            case .refreshed:
                completion(.success(()))
            case .permissionDenied:
                completion(.failure(.permissionDenied))
            case .notRefreshed:
                if !self.screenCapture.preflight() { return completion(.failure(.permissionDenied)) }
                self.onLog?("warn", "capture target not refreshed after a mode change; using the previous snapshot")
                completion(.failure(.captureUnavailable))
            }
        }
    }

    public func currentWidthPoints() -> Int { display?.currentWidthPoints() ?? 0 }
    public func displayBounds() -> CGRect { display?.bounds() ?? .zero }

    /// Idempotent: stops capture first so nothing keeps streaming a display that is going away.
    public func destroyDisplay() {
        encoder.stop()
        unwatchReconfiguration()   // before destroy: its own remove callbacks must not reach the session
        display?.destroy()
        display = nil
    }

    deinit { unwatchReconfiguration() }

    // MARK: - Display reconfiguration

    private static let reconfigurationCallback: CGDisplayReconfigurationCallBack = { display, flags, userInfo in
        guard let userInfo else { return }
        Unmanaged<ReconfigurationObserver>.fromOpaque(userInfo).takeUnretainedValue()
            .notify(display: display, flags: flags)
    }

    private func watchReconfiguration(of displayId: UInt32) {
        unwatchReconfiguration()
        let observer = ReconfigurationObserver(displayId: displayId, queue: queue, onFirstCallback: { [weak self] onMain in
            // Hardware check for the release-on-main reasoning in `unwatchReconfiguration`.
            self?.onLog?("info", "display reconfiguration callback runs on the main thread: \(onMain)")
        }) { [weak self] in
            guard let self, self.display != nil else { return }
            self.onReconfigured?()
        }
        // Retained for the registration's lifetime; released in `unwatchReconfiguration`.
        let token = Unmanaged.passRetained(observer)
        let err = CGDisplayRegisterReconfigurationCallback(Self.reconfigurationCallback, token.toOpaque())
        guard err == .success else {
            token.release()
            return Stderr.diag("display reconfiguration callback not registered (\(err.rawValue)); input bounds may go stale")
        }
        reconfiguration = observer
        reconfigurationToken = token
    }

    private func unwatchReconfiguration() {
        guard let token = reconfigurationToken else { return }
        reconfiguration?.cancel()
        CGDisplayRemoveReconfigurationCallback(Self.reconfigurationCallback, token.toOpaque())
        reconfiguration = nil
        reconfigurationToken = nil
        // Callbacks are delivered on the main run loop: release there, after any callback already
        // running has returned. `cancel()` already made a late one a no-op.
        DispatchQueue.main.async { token.release() }
    }
}

/// Filters and coalesces `CGDisplayRegisterReconfigurationCallback` notifications for one display.
///
/// `notify` may be called on any thread. Relevant notifications (our display id, not the
/// `beginConfigurationFlag` phase) schedule ONE `handler` call on `queue` after `window`; any further
/// ones before it runs are absorbed, so a burst never stacks capture restarts. The very first
/// notification (relevant or not) reports, once and on `queue`, whether it arrived on the main thread.
final class ReconfigurationObserver {
    let displayId: UInt32
    private let queue: DispatchQueue
    private let window: TimeInterval
    private let lock = NSLock()
    private var handler: (() -> Void)?
    private var scheduled = false
    private var onFirstCallback: ((Bool) -> Void)?

    init(displayId: UInt32, queue: DispatchQueue, window: TimeInterval = 0.1,
         onFirstCallback: ((Bool) -> Void)? = nil, handler: @escaping () -> Void) {
        self.displayId = displayId
        self.queue = queue
        self.window = window
        self.onFirstCallback = onFirstCallback
        self.handler = handler
    }

    static func isRelevant(display: CGDirectDisplayID, flags: CGDisplayChangeSummaryFlags, ours: UInt32) -> Bool {
        display == ours && !flags.contains(.beginConfigurationFlag)
    }

    func notify(display: CGDirectDisplayID, flags: CGDisplayChangeSummaryFlags) {
        let onMain = Thread.isMainThread
        lock.lock()
        defer { lock.unlock() }
        if let first = onFirstCallback {
            onFirstCallback = nil
            queue.async { first(onMain) }
        }
        guard Self.isRelevant(display: display, flags: flags, ours: displayId) else { return }
        guard handler != nil, !scheduled else { return }
        scheduled = true
        queue.asyncAfter(deadline: .now() + window) { [weak self] in self?.fire() }
    }

    /// No handler call after this returns (a scheduled one becomes a no-op), and no first-callback report.
    func cancel() {
        lock.lock()
        handler = nil
        onFirstCallback = nil
        lock.unlock()
    }

    private func fire() {
        lock.lock()
        scheduled = false
        let handler = self.handler
        lock.unlock()
        handler?()
    }
}
