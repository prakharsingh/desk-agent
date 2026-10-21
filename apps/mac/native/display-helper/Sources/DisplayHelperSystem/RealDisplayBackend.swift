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
    private var display: VirtualDisplayController?
    private var requestedScreenRecording = false

    public init(queue: DispatchQueue) {
        encoder = CaptureEncoder(queue: queue)
    }

    /// When Screen Recording is missing, asks once (`CGRequestScreenCaptureAccess`) so the system
    /// prompt / Settings entry appears — attributed to the responsible app (Desk Agent when spawned
    /// by main) — and still reports `false` for this session.
    public func preflightScreenRecording() -> Bool {
        if CGPreflightScreenCaptureAccess() { return true }
        if !requestedScreenRecording {
            requestedScreenRecording = true
            _ = CGRequestScreenCaptureAccess()
        }
        return false
    }

    public func preflightPostEvent() -> Bool { CGPreflightPostEventAccess() }

    public func createDisplay(maxPixels: Int, sizeInMillimeters: CGSize, modes: [ModeSpec], serialNum: UInt32,
                              vendorId: UInt32, productId: UInt32) throws -> UInt32 {
        let vd = try VirtualDisplayController(maxPixels: maxPixels, sizeInMillimeters: sizeInMillimeters,
                                              serialNum: serialNum, vendorId: vendorId, productId: productId)
        do {
            try vd.apply(modes: modes)
        } catch {
            vd.destroy()
            throw error
        }
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

    public func applyModes(_ modes: [ModeSpec]) throws {
        guard let display else { throw BackendError.unsupported }
        try display.apply(modes: modes)
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
