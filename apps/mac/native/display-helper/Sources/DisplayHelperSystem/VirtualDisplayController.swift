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
    /// Mode-activation polls run here, off the caller's (session) queue.
    private let activationQueue = DispatchQueue(label: "com.deskagent.display-helper.mode-activation")
    private let cancelled = Flag()

    /// Set once from the session queue, read from `activationQueue`.
    private final class Flag: @unchecked Sendable {
        private let lock = NSLock()
        private var value = false
        func set() { lock.lock(); value = true; lock.unlock() }
        var isSet: Bool { lock.lock(); defer { lock.unlock() }; return value }
    }

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
            Stderr.diag("virtual display terminated")
        }
        guard let vd = CGVirtualDisplay(descriptor: d) else { throw VirtualDisplayError.unsupported }
        display = vd
        displayId = vd.displayID
    }

    deinit { destroy() }

    /// Applies HiDPI modes (60 Hz), then activates a usable one asynchronously. Mode sizes are in
    /// points. Never blocks the caller: `completion` runs later on `queue` (the session queue).
    /// `onFirstUnknown` runs on `queue` once, at the first attempt whose online or mirror check
    /// CoreGraphics could not answer yet (F-M1), with the raw answers.
    public func apply(modes: [ModeSpec], deliverOn queue: DispatchQueue,
                      onFirstUnknown: ((String) -> Void)? = nil,
                      completion: @escaping (Result<Void, Error>) -> Void) {
        do {
            try applySettings(modes: modes)
        } catch {
            return queue.async { completion(.failure(error)) }
        }
        activatePreferredMode(applied: modes, deliverOn: queue, onFirstUnknown: onFirstUnknown, completion: completion)
    }

    /// `applySettings` only (fast, synchronous). Throws `destroyed` / `settingsRejected`.
    public func applySettings(modes: [ModeSpec]) throws {
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

    private static func info(_ m: CGDisplayMode) -> DisplayModeInfo {
        DisplayModeInfo(widthPoints: m.width, heightPoints: m.height, pixelWidth: m.pixelWidth, pixelHeight: m.pixelHeight,
            usableForDesktop: m.isUsableForDesktopGUI())
    }

    private static func allModes(_ displayId: UInt32) -> [CGDisplayMode] {
        let opts = [kCGDisplayShowDuplicateLowResolutionModes: true] as CFDictionary
        return (CGDisplayCopyAllDisplayModes(displayId, opts) as? [CGDisplayMode]) ?? []
    }

    /// One activation attempt: keep the preferred HiDPI mode if it is already active, otherwise switch
    /// (permanently) to the first usable applied mode.
    /// `unknown` is set when CoreGraphics could not answer the online or mirror check yet (F-M1).
    private static func attemptActivation(displayId: UInt32, applied: [ModeSpec],
                                          unknown: inout String?) -> ActivationPoll.Attempt {
        // An offline display (macOS keeps it out of the desktop, e.g. a persisted Control Center
        // "independent output" for this serial) is never configured: report it instead. A display macOS
        // put in a saved mirror set is never configured either: a mode switch completed `.permanently`
        // would rewrite the user's saved mirror set (F-mirror, fix round 1). One our process does not
        // list yet is retried, not judged mirrored (F-M1).
        let online = CGDisplayIsOnline(displayId)
        var mirror: MirrorVerdict?
        let early = ActivationPoll.preconfigureGuard(online: online, mirror: {
            let v = mirrorVerdict(displayId)
            mirror = v
            return v
        })
        if online != 0, online != 1 || mirror == .unknown {
            unknown = "CGDisplayIsOnline = \(online), mirror check \(mirror.map { "\($0)" } ?? "not run")"
        }
        if let early { return early }
        let modes = allModes(displayId)
        let current = CGDisplayCopyDisplayMode(displayId).map(info)
        switch ModeActivation.decide(current: current, available: modes.map(info), applied: applied) {
        case .keep:
            return .kept
        case .noneAvailable:
            return .notListed
        case .activate(let wanted):
            guard let target = modes.first(where: { info($0) == wanted }) else { return .notListed }
            var config: CGDisplayConfigRef?
            var err = CGBeginDisplayConfiguration(&config)
            guard err == .success else { return .switchFailed(err.rawValue) }
            err = CGConfigureDisplayWithDisplayMode(config, displayId, target, nil)
            guard err == .success else {
                CGCancelDisplayConfiguration(config)
                return .switchFailed(err.rawValue)
            }
            err = CGCompleteDisplayConfiguration(config, .permanently)
            return err == .success ? .switchSucceeded : .switchFailed(err.rawValue)
        }
    }

    /// macOS may come up in the 1x mode at the HiDPI pixel size. Polls every 100 ms for up to 3 s
    /// (`ActivationPoll`) on `activationQueue` — never on the session queue — until the preferred
    /// (first usable) HiDPI mode is active. The mode list can lag behind applySettings and a fresh display may reject
    /// configuration briefly, so "none available" and failed switches are retried; expiry fails with
    /// `modeSwitchFailed` / `modeUnavailable`, or (after 1 s offline in a row, without waiting out the
    /// 3 s) `BackendError.displayOffline`. `destroy()` cancels the poll (`destroyed`).
    private func activatePreferredMode(applied: [ModeSpec], deliverOn queue: DispatchQueue,
                                       onFirstUnknown: ((String) -> Void)?,
                                       completion: @escaping (Result<Void, Error>) -> Void) {
        let displayId = self.displayId
        let cancelled = self.cancelled
        let pollQueue = activationQueue
        var poll = ActivationPoll()
        var reportedUnknown = false
        func attempt() {
            if cancelled.isSet { return queue.async { completion(.failure(VirtualDisplayError.destroyed)) } }
            var unknown: String?
            let next = poll.record(Self.attemptActivation(displayId: displayId, applied: applied, unknown: &unknown))
            if let unknown, !reportedUnknown, let onFirstUnknown {
                reportedUnknown = true
                queue.async { onFirstUnknown(unknown) }
            }
            switch next {
            case .finished:
                queue.async { completion(.success(())) }
            case .retry:
                pollQueue.asyncAfter(deadline: .now() + ActivationPoll.interval) { attempt() }
            case .failed(.modeUnavailable):
                queue.async { completion(.failure(VirtualDisplayError.modeUnavailable)) }
            case .failed(.modeSwitchFailed(let err)):
                queue.async { completion(.failure(VirtualDisplayError.modeSwitchFailed(err))) }
            case .failed(.displayOffline):
                queue.async { completion(.failure(BackendError.displayOffline)) }
            case .failed(.displayMirrored(let why)):
                queue.async { completion(.failure(BackendError.displayMirrored(why))) }
            }
        }
        pollQueue.async { attempt() }
    }

    /// Whether `displayId` is in a macOS mirror set (`MirrorCheck.verdict`). Read-only CoreGraphics
    /// queries; never configures anything. The raw `CGDisplayIsInMirrorSet` value goes in: for a display
    /// this process does not list yet it is -1, not a mirror (F-M1).
    static func mirrorVerdict(_ displayId: UInt32) -> MirrorVerdict {
        var count: UInt32 = 0
        var ids: [CGDirectDisplayID] = []
        if CGGetOnlineDisplayList(0, nil, &count) == .success, count > 0 {
            ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
            if CGGetOnlineDisplayList(count, &ids, &count) == .success {
                ids = Array(ids.prefix(Int(count)))
            } else {
                ids = []
            }
        }
        return MirrorCheck.verdict(ours: displayId, oursInMirrorSet: CGDisplayIsInMirrorSet(displayId),
                                      oursMirrors: CGDisplayMirrorsDisplay(displayId),
                                      online: ids.map { (id: $0, mirrors: CGDisplayMirrorsDisplay($0)) })
    }

    /// Active mode (point and pixel size), nil if the display is gone.
    public func activeMode() -> DisplayModeInfo? { CGDisplayCopyDisplayMode(displayId).map(Self.info) }

    public func currentWidthPoints() -> Int { activeMode()?.widthPoints ?? Int(bounds().width) }

    public func bounds() -> CGRect { CGDisplayBounds(displayId) }

    /// Idempotent. Dropping the last reference removes the display from the system; an in-flight
    /// mode activation stops at its next attempt.
    public func destroy() {
        cancelled.set()
        display = nil
    }
}
