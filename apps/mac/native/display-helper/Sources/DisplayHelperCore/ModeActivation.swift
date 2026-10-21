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

public enum ModeActivation {
    /// Which mode to switch to after applying `applied` (preferred first), or nil to leave things alone.
    /// Keeps the current mode when it is already one of our HiDPI modes (macOS may have restored
    /// a choice the user made earlier); otherwise picks the HiDPI variant of the first applied mode
    /// that macOS considers usable (small point sizes such as 936x432 are not).
    public static func modeToActivate(
        current: DisplayModeInfo?, available: [DisplayModeInfo], applied: [ModeSpec]
    ) -> DisplayModeInfo? {
        if let current, current.isHiDPI, applied.contains(where: { $0.widthPoints == current.widthPoints }) {
            return nil
        }
        for spec in applied {
            if let m = available.first(where: {
                $0.isHiDPI && $0.usableForDesktop
                    && $0.widthPoints == spec.widthPoints && $0.heightPoints == spec.heightPoints
            }) { return m }
        }
        return nil
    }
}
