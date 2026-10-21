import CoreGraphics
import DisplayHelperCore
import DisplayHelperSystem
import Foundation
import Testing

private func isOnline(_ id: CGDirectDisplayID) -> Bool {
    var ids = [CGDirectDisplayID](repeating: 0, count: 32)
    var n: UInt32 = 0
    CGGetOnlineDisplayList(32, &ids, &n)
    return ids.prefix(Int(n)).contains(id)
}

private func wait(upTo seconds: Double, until cond: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
        if cond() { return true }
        Thread.sleep(forTimeInterval: 0.1)
    }
    return cond()
}

/// Test-only: waits for the asynchronous `apply(modes:deliverOn:completion:)` (≤ 3 s activation).
private func applyAndWait(_ c: VirtualDisplayController, _ modes: [ModeSpec]) throws {
    let done = DispatchSemaphore(value: 0)
    nonisolated(unsafe) var result: Result<Void, Error>?
    c.apply(modes: modes, deliverOn: DispatchQueue(label: "apply-wait")) { result = $0; done.signal() }
    done.wait()
    try result?.get()
}

private final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var frames = 0, keyframes = 0, paramSets = 0
    private var errors: [String] = []
    func frame(key: Bool) { lock.lock(); frames += 1; if key { keyframes += 1 }; lock.unlock() }
    func params() { lock.lock(); paramSets += 1; lock.unlock() }
    func error(_ e: Error) { lock.lock(); errors.append("\(e)"); lock.unlock() }
    var snapshot: (frames: Int, keyframes: Int, paramSets: Int, errors: [String]) {
        lock.lock(); defer { lock.unlock() }; return (frames, keyframes, paramSets, errors)
    }
}

/// Opt-in: creates a real virtual display (needs a logged-in GUI session; no TCC prompt).
/// Without DESK_AGENT_VD_INTEGRATION=1 this is reported as skipped.
@Suite(.serialized) struct VirtualDisplayIntegrationTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["DESK_AGENT_VD_INTEGRATION"] == "1"))
    func createsAppliesAndDestroysARealVirtualDisplay() throws {
        let modes = DisplayModes.modes(surfaceW: 2340, surfaceH: 1080)
        let c = try VirtualDisplayController(
            maxPixels: DisplayModes.descriptorMaxPixels(surfaceW: 2340, surfaceH: 1080),
            sizeInMillimeters: DisplayModes.sizeInMillimeters(surfaceW: 2340, surfaceH: 1080, dpi: nil),
            serialNum: 1, vendorId: 0x3456, productId: 0x4D44)
        let id = c.displayId
        defer { c.destroy() }  // always tear down, even when an expectation or throw fails the test

        try applyAndWait(c, modes)
        #expect(wait(upTo: 5) { isOnline(id) }, "display should appear in the online list within 5 s")

        // The HiDPI modes we applied must be registered on the display (point size, 2x backing pixels).
        let opts = [kCGDisplayShowDuplicateLowResolutionModes: true] as CFDictionary
        let listed = (CGDisplayCopyAllDisplayModes(id, opts) as? [CGDisplayMode]) ?? []
        for m in modes {
            #expect(
                listed.contains { $0.width == m.widthPoints && $0.pixelWidth == 2 * m.widthPoints },
                "HiDPI mode \(m.widthPoints)x\(m.heightPoints) should be listed")
        }

        // The controller activates a HiDPI mode of ours. macOS here refuses 936x432 (not usable for
        // desktop), so the first usable applied mode wins: 1170x540 pt / 2340x1080 px.
        let w = c.bounds().width
        #expect(w == 1170, "bounds width \(w) should be 1170")
        #expect(c.currentWidthPoints() == 1170)
        #expect(c.activeMode()?.pixelWidth == 2340)

        c.destroy()
        // Typically ~0.1 s; one run after a permanent mode switch exceeded 2 s, so allow 5 s.
        #expect(wait(upTo: 5) { !isOnline(id) }, "display should leave the online list within 5 s")
    }

    /// Opt-in capture feasibility probe (Task 1.5 Step 5b). Needs Screen Recording for the calling
    /// terminal, an unlocked screen, and content changing on the virtual display during the 10 s window
    /// (ScreenCaptureKit only delivers frames when something changes). Provide that content with the
    /// in-repo animator, started first in another shell (it waits up to 60 s for the display):
    ///
    ///     swift run --package-path tools/animator animator 15 &
    ///     DESK_AGENT_CAPTURE_PROBE=1 scripts/test.sh --filter captureProducesCompleteSamples
    @Test(.enabled(if: ProcessInfo.processInfo.environment["DESK_AGENT_CAPTURE_PROBE"] == "1"))
    func captureProducesCompleteSamples() throws {
        let c = try VirtualDisplayController(
            maxPixels: DisplayModes.descriptorMaxPixels(surfaceW: 2340, surfaceH: 1080),
            sizeInMillimeters: DisplayModes.sizeInMillimeters(surfaceW: 2340, surfaceH: 1080, dpi: nil),
            serialNum: 1, vendorId: 0x3456, productId: 0x4D44)
        defer { c.destroy() }
        try applyAndWait(c, DisplayModes.modes(surfaceW: 2340, surfaceH: 1080))

        let q = DispatchQueue(label: "capture-probe")
        let encoder = CaptureEncoder(queue: q)
        defer { encoder.stop() }
        let counter = Counter()
        encoder.onFrame = { _, key in counter.frame(key: key) }
        encoder.onParameterSets = { _, _, _ in counter.params() }
        encoder.onError = { counter.error($0) }

        let ready = DispatchSemaphore(value: 0)
        nonisolated(unsafe) var result: Result<Void, BackendError>?
        encoder.waitUntilCapturable(displayId: c.displayId, timeout: 5) { result = $0; ready.signal() }
        ready.wait()
        try #require(result.map { if case .success = $0 { true } else { false } } == true,
                     "display should become capturable: \(String(describing: result))")

        let w = c.activeMode()?.pixelWidth ?? 2340
        let h = c.activeMode()?.pixelHeight ?? 1080
        try encoder.start(displayId: c.displayId, width: w, height: h, showsCursor: true)
        print("tools/animator should now be flashing a window on Desk Agent Phone (display \(c.displayId), bounds \(c.bounds()), stream \(w)x\(h))")
        Thread.sleep(forTimeInterval: 10)
        encoder.stop()
        Thread.sleep(forTimeInterval: 0.2)   // let queued encoder outputs drain

        let s = counter.snapshot
        print("capture probe: completeSamples=\(encoder.completeSamples) frames=\(s.frames) keyframes=\(s.keyframes) paramSets=\(s.paramSets) errors=\(s.errors)")
        #expect(encoder.completeSamples >= 30, "need >= 30 .complete samples, got \(encoder.completeSamples)")
        #expect(s.frames > 0, "encoder should emit Annex-B frames")
        #expect(s.paramSets >= 1, "parameter sets should be emitted before the first frame")
        #expect(s.errors.isEmpty, "no capture/encode errors: \(s.errors)")
    }
}
