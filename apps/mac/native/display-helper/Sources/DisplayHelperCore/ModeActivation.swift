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
    /// The preferred HiDPI mode is already active.
    case keep(DisplayModeInfo)
    /// Switch to this mode.
    case activate(DisplayModeInfo)
    /// No usable HiDPI variant of any applied mode is listed (yet). Callers should keep polling.
    case noneAvailable
}

public enum ModeActivation {
    /// Decide what to do after applying `applied` (preferred first). The target is the HiDPI variant
    /// (2x pixels, matching point width and height) of the first applied mode macOS considers usable
    /// (small point sizes such as 936x432 are not). Keeps the current mode only when it is that
    /// target: macOS may restore or auto-pick the HiDPI variant of another applied mode (device run 4,
    /// F2: 2260x1080@2x in landscape), which must not be kept, or the next rotation derives that
    /// mode's divisor. Reports `noneAvailable` when no applied mode has a usable HiDPI variant.
    public static func decide(
        current: DisplayModeInfo?, available: [DisplayModeInfo], applied: [ModeSpec]
    ) -> ModeDecision {
        func isHiDPIVariant(_ m: DisplayModeInfo, of spec: ModeSpec) -> Bool {
            m.isHiDPI && m.pixelHeight == 2 * m.heightPoints
                && m.widthPoints == spec.widthPoints && m.heightPoints == spec.heightPoints
        }
        for spec in applied {
            if let m = available.first(where: { $0.usableForDesktop && isHiDPIVariant($0, of: spec) }) {
                if let current, isHiDPIVariant(current, of: spec) { return .keep(current) }
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
        /// `ModeDecision.keep`: the preferred HiDPI mode is already active.
        case kept
        /// The configuration switch to the wanted mode succeeded.
        case switchSucceeded
        /// No usable mode listed yet (`noneAvailable`, or the wanted mode vanished from the list).
        case notListed
        /// CGConfigureDisplayWithDisplayMode / CGCompleteDisplayConfiguration failed with this CGError.
        case switchFailed(Int32)
        /// The display is not online (`CGDisplayIsOnline` false), so nothing was decided or configured.
        case offline
        /// CoreGraphics in this process cannot tell yet whether the display is online (F-M1: it does not
        /// list the new display and `CGDisplayIsOnline` answers -1). Nothing was configured. Neither
        /// online nor offline: it never counts as seen online and never breaks an offline streak, so a
        /// whole poll of these ends `displayOffline` (the identity chain goes on) and a switched-off
        /// identity created during the lag still ends `displayOffline` once CG catches up.
        case unknown
        /// The display is in a macOS mirror set (`MirrorCheck`), so nothing was decided or configured:
        /// a mode switch would rewrite the user's saved mirror set. Carries the queries that fired.
        case mirrored(String)
    }

    public enum Failure: Error, Equatable {
        /// The preferred HiDPI mode never appeared.
        case modeUnavailable
        /// It appeared, but switching to it kept failing (the last CGError).
        case modeSwitchFailed(Int32)
        /// The display was offline for `offlineGiveUpAttempts` attempts in a row: macOS keeps it out
        /// of the desktop.
        case displayOffline
        /// The display is mirrored: activation stops at once without configuring anything. Carries the
        /// queries that fired.
        case displayMirrored(String)
    }

    public enum Next: Equatable {
        case finished
        case retry
        case failed(Failure)
    }

    public private(set) var attempts = 0
    /// `.unknown` attempts so far (logged once per display by the caller).
    public private(set) var unknownAttempts = 0
    private var sawTarget = false
    private var sawOnline = false
    private var offlineStreak = 0
    private var lastError: Int32 = 0

    public init() {}

    /// The checks before any configuration call of one attempt, from the raw `CGDisplayIsOnline` value:
    /// 0 → `offline` (`mirror` is then not queried). Otherwise the mirror check: a mirror (a listed
    /// display naming ours counts even while ours is unlisted) → `mirrored`. An online answer other than
    /// 1 (F-M1: -1 while our process does not list the display) → `unknown`. Online but a mirror verdict
    /// CG cannot give yet → `notListed`, retried as while the mode list lags. `nil` = go on and decide.
    public static func preconfigureGuard(online: Int32, mirror: () -> MirrorVerdict) -> Attempt? {
        guard online != 0 else { return .offline }
        let verdict = mirror()
        if case .mirrored(let why) = verdict { return .mirrored(why) }
        guard online == 1 else { return .unknown }
        return verdict == .unknown ? .notListed : nil
    }

    public mutating func record(_ attempt: Attempt) -> Next {
        attempts += 1
        switch attempt {
        case .kept, .switchSucceeded:
            return .finished
        case .mirrored(let why):
            return .failed(.displayMirrored(why))
        case .switchFailed(let err):
            sawOnline = true
            sawTarget = true
            lastError = err
        case .notListed:
            sawOnline = true
        case .offline:
            break
        case .unknown:
            unknownAttempts += 1
        }
        if attempt == .offline {
            offlineStreak += 1
        } else if attempt != .unknown {
            offlineStreak = 0
        }
        // Offline for a second straight (even after an online attempt: ControlCenter re-asserts a
        // persisted independent output ~0.15 s after the display appears) → macOS keeps it switched off.
        guard offlineStreak < Self.offlineGiveUpAttempts else { return .failed(.displayOffline) }
        guard attempts >= Self.maxAttempts else { return .retry }
        guard sawOnline else { return .failed(.displayOffline) }
        return .failed(sawTarget ? .modeSwitchFailed(lastError) : .modeUnavailable)
    }
}
