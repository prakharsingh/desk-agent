/// A display mode as the OS reports it: size in points plus backing pixels.
public struct DisplayModeInfo: Equatable {
    public let widthPoints: Int
    public let heightPoints: Int
    public let pixelWidth: Int
    public let pixelHeight: Int
    /// `CGDisplayMode.isUsableForDesktopGUI()`. macOS rejects configuring unusable modes.
    public let usableForDesktop: Bool

    public init(widthPoints: Int, heightPoints: Int, pixelWidth: Int, pixelHeight: Int, usableForDesktop: Bool = true) {
        self.widthPoints = widthPoints
        self.heightPoints = heightPoints
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.usableForDesktop = usableForDesktop
    }

    public var isHiDPI: Bool { pixelWidth == 2 * widthPoints }
}

public enum ModeDecision: Equatable {
    /// A HiDPI mode of ours is already active (macOS may have restored an earlier user choice).
    case keep(DisplayModeInfo)
    /// Switch to this mode.
    case activate(DisplayModeInfo)
    /// No usable HiDPI variant of any applied mode is listed (yet). Callers should keep polling.
    case noneAvailable
}

public enum ModeActivation {
    /// Decide what to do after applying `applied` (preferred first). Keeps the current mode when it is
    /// a HiDPI variant (2x pixels) of an applied mode, matching both point width and height; otherwise
    /// activates the HiDPI variant of the first applied mode macOS considers usable (small point
    /// sizes such as 936x432 are not); otherwise reports `noneAvailable`.
    public static func decide(
        current: DisplayModeInfo?, available: [DisplayModeInfo], applied: [ModeSpec]
    ) -> ModeDecision {
        func isHiDPIVariant(_ m: DisplayModeInfo, of spec: ModeSpec) -> Bool {
            m.isHiDPI && m.pixelHeight == 2 * m.heightPoints
                && m.widthPoints == spec.widthPoints && m.heightPoints == spec.heightPoints
        }
        if let current, applied.contains(where: { isHiDPIVariant(current, of: $0) }) {
            return .keep(current)
        }
        for spec in applied {
            if let m = available.first(where: { $0.usableForDesktop && isHiDPIVariant($0, of: spec) }) {
                return .activate(m)
            }
        }
        return .noneAvailable
    }
}
