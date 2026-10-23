import Foundation

/// Whether our virtual display is part of a macOS mirror set, from read-only CoreGraphics queries
/// (`CGDisplayIsInMirrorSet`, `CGDisplayMirrorsDisplay` over `CGGetOnlineDisplayList`). macOS saves a
/// Control Center "Entire Screen" choice per set of display identities and restores it silently when
/// that identity is created again (spare-mirror-report §2), so the display comes up mirroring instead
/// of extending the desktop. The helper never changes a mirror set; it only detects one.
public enum MirrorCheck {
    /// What `CGDisplayMirrorsDisplay` answered for a display id this process's CoreGraphics did not list
    /// (probe 2026-10-24 on macOS 27.0.1, build 26A434; F-M1). OBSERVED, NOT DOCUMENTED: Apple documents
    /// only `kCGNullDirectDisplay` (0) for "not a mirror"; this value and the -1 that
    /// `CGDisplayIsInMirrorSet` / `CGDisplayIsOnline` answered are in no header or doc. So `verdict`
    /// does not depend on them alone: ours listed with exactly 0 answers is clean, a genuine positive
    /// answer is a mirror, and anything else from ours is `.unknown`, which fails safe (retry) if a
    /// future macOS answers with another value.
    public static let queryError: UInt32 = 0xFFFF_FFFF

    /// Mirrored when ours is in a mirror set, mirrors another display, or another online display
    /// mirrors ours (we are the master: F-mirror, where the LG became our secondary). `0` is
    /// `kCGNullDirectDisplay`; `oursInMirrorSet` is the raw `boolean_t`.
    ///
    /// F-M1: CoreGraphics answers from per-process display state that WindowServer's notifications
    /// refresh on the main run loop. Right after a mirrored identity is destroyed and a new one created,
    /// that state can still lack the new display (WindowServer was itself waiting out client
    /// acknowledgements); queries about it then return the error values -1 / `queryError`, which are
    /// non-zero. While `ours` is not in `online` (`CGGetOnlineDisplayList`), or its own answers are
    /// error values, the verdict is `.unknown` unless a display we do list names ours as its master.
    public static func verdict(ours: UInt32, oursInMirrorSet: Int32, oursMirrors: UInt32,
                               online: [(id: UInt32, mirrors: UInt32)]) -> MirrorVerdict {
        let listed = online.contains { $0.id == ours }
        var fired: [String] = []
        if listed, oursInMirrorSet == 1 { fired.append("CGDisplayIsInMirrorSet(\(hex(ours)))=1") }
        if listed, oursMirrors != 0, oursMirrors != queryError {
            fired.append("CGDisplayMirrorsDisplay(\(hex(ours)))=\(hex(oursMirrors))")
        }
        for other in online where other.id != ours && other.mirrors == ours {
            fired.append("CGDisplayMirrorsDisplay(\(hex(other.id)))=\(hex(ours))")
        }
        if !fired.isEmpty { return .mirrored(fired.joined(separator: ", ")) }
        guard listed, oursInMirrorSet == 0, oursMirrors != queryError else { return .unknown }
        return .notMirrored
    }

    static func hex(_ id: UInt32) -> String { String(format: "0x%08x", id) }
}

/// The answer of one mirror check (`MirrorCheck.verdict`).
public enum MirrorVerdict: Equatable {
    case notMirrored
    /// CoreGraphics in this process cannot tell yet (F-M1): it does not list our display, or answered
    /// with error values. Never treated as a mirror.
    case unknown
    /// Which read-only queries reported the mirror, with their values (logged with every judgement).
    case mirrored(String)

    public var isMirrored: Bool { if case .mirrored = self { return true } else { return false } }
}

/// Bookkeeping for the start-time mirror check, after mode activation succeeded. WindowServer restores
/// a saved mirror set in `request_resources`, about 9 ms after the display is created (device run 6,
/// spare-mirror-report §1b), so it is usually visible at the first check; the remaining checks give it
/// a margin of `window` (0.25 s) in case it lands after an unusually fast activation. Mirrored at any
/// check → `.mirrored` at once; never mirrored across all `checks` → `.clear`. The window is part of the
/// start budget (`SessionController.startBudget`).
public struct MirrorSettlePoll {
    public static let interval: TimeInterval = 0.05
    public static let checks = 6
    /// Time from the first check to the last.
    public static let window: TimeInterval = interval * Double(checks - 1)

    public enum Next: Equatable {
        case mirrored
        case clear
        case retry
    }

    public private(set) var attempts = 0

    public init() {}

    public mutating func record(mirrored: Bool) -> Next {
        attempts += 1
        if mirrored { return .mirrored }
        return attempts >= Self.checks ? .clear : .retry
    }
}
