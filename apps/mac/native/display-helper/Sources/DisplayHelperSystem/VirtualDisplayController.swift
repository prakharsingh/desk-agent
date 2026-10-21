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
    }

    public func currentWidthPoints() -> Int { Int(bounds().width) }

    public func bounds() -> CGRect { CGDisplayBounds(displayId) }

    /// Idempotent. Dropping the last reference removes the display from the system.
    public func destroy() { display = nil }
}
