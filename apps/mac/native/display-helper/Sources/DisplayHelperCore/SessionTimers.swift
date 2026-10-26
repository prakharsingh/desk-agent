import Foundation

/// Feed with `heard(at:)` on any valid frame from the authenticated phone.
public struct KeepaliveWatchdog: Sendable {
    public let activeTimeout: TimeInterval
    public let pausedTimeout: TimeInterval
    private var lastHeard: TimeInterval
    private var paused = false

    public init(activeTimeout: TimeInterval = 2.0, pausedTimeout: TimeInterval = 10.0, now: TimeInterval) {
        self.activeTimeout = activeTimeout
        self.pausedTimeout = pausedTimeout
        self.lastHeard = now
    }

    public mutating func heard(at t: TimeInterval) { lastHeard = t }

    /// A pause/resume frame is itself a frame from the phone, so it counts as hearing it.
    public mutating func setPaused(_ paused: Bool, at t: TimeInterval) {
        self.paused = paused
        lastHeard = t
    }

    public func isExpired(at t: TimeInterval) -> Bool {
        t - lastHeard > (paused ? pausedTimeout : activeTimeout)
    }
}

/// Measured from the helper's `ready` event.
public struct ConnectDeadline: Sendable {
    public let createdAt: TimeInterval
    public let timeout: TimeInterval

    public init(createdAt: TimeInterval, timeout: TimeInterval = 10.0) {
        self.createdAt = createdAt
        self.timeout = timeout
    }

    public func isExpired(at t: TimeInterval) -> Bool { t - createdAt > timeout }
}
