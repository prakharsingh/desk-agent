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

/// Opt-in: creates a real virtual display (needs a logged-in GUI session; no TCC prompt).
/// Without DESK_AGENT_VD_INTEGRATION=1 this is reported as skipped.
@Suite struct VirtualDisplayIntegrationTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["DESK_AGENT_VD_INTEGRATION"] == "1"))
    func createsAppliesAndDestroysARealVirtualDisplay() throws {
        let modes = DisplayModes.modes(surfaceW: 2340, surfaceH: 1080)
        let c = try VirtualDisplayController(
            maxPixels: DisplayModes.descriptorMaxPixels(surfaceW: 2340, surfaceH: 1080),
            sizeInMillimeters: DisplayModes.sizeInMillimeters(surfaceW: 2340, surfaceH: 1080, dpi: nil),
            serialNum: 1, vendorId: 0x3456, productId: 0x4D44)
        let id = c.displayId
        defer { c.destroy() }  // always tear down, even when an expectation or throw fails the test

        try c.apply(modes: modes)
        #expect(wait(upTo: 5) { isOnline(id) }, "display should appear in the online list within 5 s")

        // The HiDPI modes we applied must be registered on the display (point size, 2x backing pixels).
        let opts = [kCGDisplayShowDuplicateLowResolutionModes: true] as CFDictionary
        let listed = (CGDisplayCopyAllDisplayModes(id, opts) as? [CGDisplayMode]) ?? []
        for m in modes {
            #expect(
                listed.contains { $0.width == m.widthPoints && $0.pixelWidth == 2 * m.widthPoints },
                "HiDPI mode \(m.widthPoints)x\(m.heightPoints) should be listed")
        }

        // macOS decides which mode is active (observed: the 1x mode at a HiDPI mode's pixel size),
        // so do not assume the first applied mode. Accept an applied point width or its 2x pixel width.
        let accepted = modes.flatMap { [CGFloat($0.widthPoints), CGFloat(2 * $0.widthPoints)] }
        let w = c.bounds().width
        #expect(accepted.contains(w), "bounds width \(w) should be one of \(accepted)")

        c.destroy()
        #expect(wait(upTo: 2) { !isOnline(id) }, "display should leave the online list within 2 s")
    }
}
