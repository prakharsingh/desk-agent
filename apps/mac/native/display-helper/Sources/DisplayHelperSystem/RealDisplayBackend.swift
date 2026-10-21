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
    private let queue: DispatchQueue
    private var display: VirtualDisplayController?
    private let screenCapture: ScreenCaptureAccess

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

    public func createDisplay(maxPixels: Int, sizeInMillimeters: CGSize, serialNum: UInt32,
                              vendorId: UInt32, productId: UInt32) throws -> UInt32 {
        let vd = try VirtualDisplayController(maxPixels: maxPixels, sizeInMillimeters: sizeInMillimeters,
                                              serialNum: serialNum, vendorId: vendorId, productId: productId)
        display = vd
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
        display.apply(modes: modes, deliverOn: queue, completion: completion)
    }

    public func currentWidthPoints() -> Int { display?.currentWidthPoints() ?? 0 }
    public func displayBounds() -> CGRect { display?.bounds() ?? .zero }

    /// Idempotent: stops capture first so nothing keeps streaming a display that is going away.
    public func destroyDisplay() {
        encoder.stop()
        display?.destroy()
        display = nil
    }
}
