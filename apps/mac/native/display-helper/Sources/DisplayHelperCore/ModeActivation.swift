import Foundation

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

/// Retry bookkeeping for activating a mode after `applySettings`: the mode list can lag behind the
/// settings and a fresh display may reject configuration briefly, so attempts are repeated every
/// `interval` for up to `maxAttempts` (3 s). The poll itself runs asynchronously (VirtualDisplayController);
/// this only decides retry / finish / give up.
public struct ActivationPoll {
    public static let maxAttempts = 30
    public static let interval: TimeInterval = 0.1
    /// This many offline attempts in a row (1 s) end the poll early with `displayOffline`.
    public static let offlineGiveUpAttempts = 10

    /// What one attempt observed or did.
    public enum Attempt: Equatable {
        /// `ModeDecision.keep`: a HiDPI mode of ours is already active.
        case kept
        /// The configuration switch to the wanted mode succeeded.
        case switchSucceeded
        /// No usable mode listed yet (`noneAvailable`, or the wanted mode vanished from the list).
        case notListed
        /// CGConfigureDisplayWithDisplayMode / CGCompleteDisplayConfiguration failed with this CGError.
        case switchFailed(Int32)
        /// The display is not online (`CGDisplayIsOnline` false), so nothing was decided or configured.
        case offline
    }

    public enum Failure: Error, Equatable {
        /// The preferred HiDPI mode never appeared.
        case modeUnavailable
        /// It appeared, but switching to it kept failing (the last CGError).
        case modeSwitchFailed(Int32)
        /// The display was offline for `offlineGiveUpAttempts` attempts in a row: macOS keeps it out
        /// of the desktop.
        case displayOffline
    }

    public enum Next: Equatable {
        case finished
        case retry
        case failed(Failure)
    }

    public private(set) var attempts = 0
    private var sawTarget = false
    private var sawOnline = false
    private var offlineStreak = 0
    private var lastError: Int32 = 0

    public init() {}

    public mutating func record(_ attempt: Attempt) -> Next {
        attempts += 1
        switch attempt {
        case .kept, .switchSucceeded:
            return .finished
        case .switchFailed(let err):
            sawOnline = true
            sawTarget = true
            lastError = err
        case .notListed:
            sawOnline = true
        case .offline:
            break
        }
        offlineStreak = attempt == .offline ? offlineStreak + 1 : 0
        // Offline for a second straight (even after an online attempt: ControlCenter re-asserts a
        // persisted independent output ~0.15 s after the display appears) → macOS keeps it switched off.
        guard offlineStreak < Self.offlineGiveUpAttempts else { return .failed(.displayOffline) }
        guard attempts >= Self.maxAttempts else { return .retry }
        guard sawOnline else { return .failed(.displayOffline) }
        return .failed(sawTarget ? .modeSwitchFailed(lastError) : .modeUnavailable)
    }
}
