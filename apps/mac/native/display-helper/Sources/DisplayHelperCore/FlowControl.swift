import Foundation

/// Video flow-control window. `ack` is cumulative (rendered OR dropped).
public struct FlowControl: Sendable {
    public static let latencyWindow = 120

    public let maxUnacked: UInt64
    public let stallTimeout: TimeInterval
    public private(set) var lastSent: UInt64 = 0
    public private(set) var acked: UInt64 = 0

    private var blockedSince: TimeInterval?
    private var sentAt: [UInt64: TimeInterval] = [:]   // last `latencyWindow` seqs
    private var latenciesMs: [Double] = []              // last `latencyWindow` samples

    public init(maxUnacked: UInt64 = 2, stallTimeout: TimeInterval = 1.0) {
        self.maxUnacked = maxUnacked
        self.stallTimeout = stallTimeout
    }

    public var canSend: Bool { lastSent - acked <= maxUnacked }

    /// Monotonic for the whole session; starts at 1 and never restarts.
    public mutating func nextSeq(sentAt t: TimeInterval) -> UInt64 {
        lastSent += 1
        sentAt[lastSent] = t
        if lastSent > UInt64(Self.latencyWindow) {
            sentAt[lastSent - UInt64(Self.latencyWindow)] = nil
        }
        if !canSend && blockedSince == nil { blockedSince = t }
        return lastSent
    }

    /// Returns true if the window flipped from closed to open.
    @discardableResult
    public mutating func ack(_ seq: UInt64, at t: TimeInterval) -> Bool {
        guard seq > acked, seq <= lastSent else { return false }
        let wasBlocked = !canSend
        // Latency for every newly covered seq that we still remember.
        var s = max(acked + 1, seq > UInt64(Self.latencyWindow) ? seq - UInt64(Self.latencyWindow) + 1 : 1)
        while s <= seq {
            if let sent = sentAt[s] {
                latenciesMs.append(max(0, (t - sent) * 1000))
            }
            s += 1
        }
        if latenciesMs.count > Self.latencyWindow {
            latenciesMs.removeFirst(latenciesMs.count - Self.latencyWindow)
        }
        acked = seq
        let reopened = wasBlocked && canSend
        if canSend { blockedSince = nil }
        return reopened
    }

    /// Clears the window; keeps the seq counter.
    public mutating func reset() {
        acked = lastSent
        blockedSince = nil
    }

    public func isStalled(at t: TimeInterval) -> Bool {
        guard !canSend, let since = blockedSince else { return false }
        return t - since > stallTimeout
    }

    public func latencyPercentiles() -> (p50: Double, p95: Double) {
        guard !latenciesMs.isEmpty else { return (0, 0) }
        let sorted = latenciesMs.sorted()
        func pct(_ p: Double) -> Double {
            let rank = Int((Double(sorted.count) * p).rounded(.up))   // nearest-rank
            return sorted[min(sorted.count - 1, max(0, rank - 1))]
        }
        return (pct(0.50), pct(0.95))
    }
}
