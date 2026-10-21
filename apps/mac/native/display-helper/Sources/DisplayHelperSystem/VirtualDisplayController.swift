import CVirtualDisplay
import CoreGraphics
import DisplayHelperCore
import Foundation

public enum VirtualDisplayError: Error, Equatable {
    /// `CGVirtualDisplay` refused to initialise (private API unavailable or rejected the descriptor).
    case unsupported
    /// `applySettings` returned NO.
    case settingsRejected
    /// Called after `destroy()`.
    case destroyed
    /// The preferred HiDPI mode never appeared in the display's mode list.
    case modeUnavailable
    /// CGConfigureDisplayWithDisplayMode / CGCompleteDisplayConfiguration failed.
    case modeSwitchFailed(Int32)
}

/// Owns a private `CGVirtualDisplay`. Releasing it (via `destroy()`) removes the display.
public final class VirtualDisplayController {
    private var display: CGVirtualDisplay?
    public let displayId: UInt32

    /// `maxPixels` is applied to both axes and is fixed for the display's lifetime, so it must
    /// cover both orientations (see `DisplayModes.descriptorMaxPixels`). A zero `serialNum`
    /// is replaced with 1 (a zero serial makes macOS treat displays as interchangeable).
    public init(
        name: String = "Desk Agent Phone",
        maxPixels: Int,
        sizeInMillimeters: CGSize,
        serialNum: UInt32,
        vendorId: UInt32,
        productId: UInt32
    ) throws {
        let d = CGVirtualDisplayDescriptor()
        d.queue = DispatchQueue.global(qos: .userInitiated)
        d.name = name
        d.maxPixelsWide = UInt32(maxPixels)
        d.maxPixelsHigh = UInt32(maxPixels)
        d.sizeInMillimeters = sizeInMillimeters
        d.vendorID = vendorId
        d.productID = productId
        d.serialNum = serialNum == 0 ? 1 : serialNum
        d.terminationHandler = { _, _ in
            FileHandle.standardError.write(Data("[display-helper] virtual display terminated\n".utf8))
        }
        guard let vd = CGVirtualDisplay(descriptor: d) else { throw VirtualDisplayError.unsupported }
        display = vd
        displayId = vd.displayID
    }

    deinit { destroy() }

    /// Applies HiDPI modes (60 Hz). Mode sizes are in points.
    public func apply(modes: [ModeSpec]) throws {
        guard let vd = display else { throw VirtualDisplayError.destroyed }
        let s = CGVirtualDisplaySettings()
        s.hiDPI = 1
        // The private initializer is nullable (implicitly unwrapped): drop a nil mode rather than
        // letting an Optional land in the untyped `modes` array.
        s.modes = modes.compactMap { spec -> CGVirtualDisplayMode? in
            CGVirtualDisplayMode(width: UInt32(spec.widthPoints), height: UInt32(spec.heightPoints), refreshRate: 60)
        }
        guard vd.apply(s) else { throw VirtualDisplayError.settingsRejected }
        try activatePreferredMode(applied: modes)
    }

    private static func info(_ m: CGDisplayMode) -> DisplayModeInfo {
        DisplayModeInfo(widthPoints: m.width, heightPoints: m.height, pixelWidth: m.pixelWidth, pixelHeight: m.pixelHeight,
            usableForDesktop: m.isUsableForDesktopGUI())
    }

    private func allModes() -> [CGDisplayMode] {
        let opts = [kCGDisplayShowDuplicateLowResolutionModes: true] as CFDictionary
        return (CGDisplayCopyAllDisplayModes(displayId, opts) as? [CGDisplayMode]) ?? []
    }

    /// macOS may come up in the 1x mode at the HiDPI pixel size; switch (permanently) to the
    /// preferred HiDPI mode unless a HiDPI mode of ours is already active. The mode list can lag
    /// behind applySettings, so poll briefly.
    private func activatePreferredMode(applied: [ModeSpec]) throws {
        var target: CGDisplayMode?
        for _ in 0..<50 {
            let modes = allModes()
            let current = CGDisplayCopyDisplayMode(displayId).map(Self.info)
            let wanted = ModeActivation.modeToActivate(
                current: current, available: modes.map(Self.info), applied: applied)
            guard let wanted else { return }  // nothing to change
            target = modes.first { Self.info($0) == wanted }
            if target != nil { break }
            Thread.sleep(forTimeInterval: 0.1)
        }
        guard let target else { throw VirtualDisplayError.modeUnavailable }
        var lastError: Int32 = 0
        for _ in 0..<30 {  // the freshly created display may not accept configuration immediately
            var config: CGDisplayConfigRef?
            var err = CGBeginDisplayConfiguration(&config)
            if err == .success { err = CGConfigureDisplayWithDisplayMode(config, displayId, target, nil) }
            if err == .success {
                err = CGCompleteDisplayConfiguration(config, .permanently)
                if err == .success { return }
            } else {
                CGCancelDisplayConfiguration(config)
            }
            lastError = err.rawValue
            Thread.sleep(forTimeInterval: 0.1)
        }
        throw VirtualDisplayError.modeSwitchFailed(lastError)
    }

    /// Active mode (point and pixel size), nil if the display is gone.
    public func activeMode() -> DisplayModeInfo? { CGDisplayCopyDisplayMode(displayId).map(Self.info) }

    public func currentWidthPoints() -> Int { activeMode()?.widthPoints ?? Int(bounds().width) }

    public func bounds() -> CGRect { CGDisplayBounds(displayId) }

    /// Idempotent. Dropping the last reference removes the display from the system.
    public func destroy() { display = nil }
}
