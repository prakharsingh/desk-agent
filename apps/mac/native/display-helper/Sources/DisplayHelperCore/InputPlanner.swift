import Foundation
import CoreGraphics

public enum SyntheticEvent: Equatable {
    case move(CGPoint)
    case leftDown(CGPoint, clickState: Int64)
    case leftDragged(CGPoint)
    case leftUp(CGPoint, clickState: Int64)
    case rightDown(CGPoint)
    case rightUp(CGPoint)
    case scroll(dxPoints: Int32, dyPoints: Int32)
}

/// Pure translation of semantic phone input into synthetic mouse events.
/// The caller posts the returned events; nothing here touches the system.
public struct InputPlanner {
    private var bounds: CGRect
    private var cursor: CGPoint
    private let doubleClickInterval: TimeInterval
    private let doubleClickSlop: CGFloat
    private let trackpadGain: CGFloat
    private var leftHeld = false
    private var lastClick: (point: CGPoint, t: TimeInterval, state: Int64)?
    /// Sub-point scroll carried to the next `scroll` (per axis) so slow scrolls still add up.
    /// Cleared by any non-scroll event.
    private var scrollRemainder = (x: 0.0, y: 0.0)

    public init(bounds: CGRect, cursor: CGPoint, doubleClickInterval: TimeInterval = 0.5,
                doubleClickSlop: CGFloat = 16, trackpadGain: CGFloat = 1.5) {
        self.bounds = bounds
        self.doubleClickInterval = doubleClickInterval
        self.doubleClickSlop = doubleClickSlop
        self.trackpadGain = trackpadGain
        self.cursor = cursor
        self.cursor = clamp(cursor)
    }

    public mutating func updateBounds(_ bounds: CGRect) {
        self.bounds = bounds
        cursor = clamp(cursor)
    }

    /// Adopts the real pointer position `p` (it may have moved since the last planned event, e.g. by
    /// the Mac's own mouse) when it lies on this display; a pointer elsewhere keeps the old cursor.
    public mutating func syncCursor(_ p: CGPoint) {
        guard p.x.isFinite, p.y.isFinite, bounds.contains(p) else { return }
        cursor = p
    }

    /// True for events that act at (or relative to) the cursor: trackpad `move`, and `click` /
    /// `rightClick` without coordinates. Callers sync the real pointer before planning these.
    public static func actsAtCursor(_ e: InputEvent) -> Bool {
        switch e.kind {
        case .move: return true
        case .click, .rightClick:
            // Mirrors `point(_:)`: missing or non-finite coordinates mean "at the cursor".
            guard let x = e.x, let y = e.y, x.isFinite, y.isFinite else { return true }
            return false
        default: return false
        }
    }

    public mutating func teardown() -> [SyntheticEvent] {
        scrollRemainder = (0, 0)
        return releaseHeld()
    }

    public mutating func plan(_ event: InputEvent, at t: TimeInterval) -> [SyntheticEvent] {
        if event.kind != .scroll { scrollRemainder = (0, 0) }
        switch event.kind {
        case .click:
            var out = releaseHeld()
            let p = point(event)
            let state = nextClickState(at: p, t: t)
            lastClick = (p, t, state)
            cursor = p
            out += [.move(p), .leftDown(p, clickState: state), .leftUp(p, clickState: state)]
            return out
        case .rightClick:
            var out = releaseHeld()
            let p = point(event)
            lastClick = nil
            cursor = p
            out += [.move(p), .rightDown(p), .rightUp(p)]
            return out
        case .dragStart:
            var out = releaseHeld()
            let p = point(event)
            lastClick = nil
            cursor = p
            leftHeld = true
            out += [.move(p), .leftDown(p, clickState: 1)]
            return out
        case .dragMove:
            let p = point(event)
            cursor = p
            // Without a held button a drag is just a pointer move, never a phantom drag.
            return leftHeld ? [.leftDragged(p)] : [.move(p)]
        case .dragEnd:
            guard leftHeld else { return [] }
            let p = point(event)
            cursor = p
            leftHeld = false
            return [.leftUp(p, clickState: 1)]
        case .scroll:
            let sx = scrollPoints(event.dx, Double(bounds.width), carry: &scrollRemainder.x)
            let sy = scrollPoints(event.dy, Double(bounds.height), carry: &scrollRemainder.y)
            if sx == 0 && sy == 0 { return [] }
            var out: [SyntheticEvent] = []
            if leftHeld {
                leftHeld = false
                out.append(.leftUp(cursor, clickState: 0))
            }
            // Absolute mode sends the two-finger centroid: scroll there, not wherever the pointer is.
            if let x = event.x, let y = event.y, x.isFinite, y.isFinite {
                let p = point(event)
                cursor = p
                out.append(.move(p))
            }
            out.append(.scroll(dxPoints: sx, dyPoints: sy))
            return out
        case .move:
            // Trackpad mode never holds the button, so a move stays a plain .move.
            let dx = CGFloat(finite(event.dx)) * bounds.width * trackpadGain
            let dy = CGFloat(finite(event.dy)) * bounds.height * trackpadGain
            cursor = clamp(CGPoint(x: cursor.x + dx, y: cursor.y + dy))
            return [.move(cursor)]
        case .unknown:
            return []
        }
    }

    private func nextClickState(at p: CGPoint, t: TimeInterval) -> Int64 {
        guard let last = lastClick,
              t - last.t >= 0, t - last.t <= doubleClickInterval,
              hypot(p.x - last.point.x, p.y - last.point.y) <= doubleClickSlop
        else { return 1 }
        return min(last.state + 1, 3)
    }

    /// Normalized coordinates map into bounds; without coordinates the event acts at the cursor.
    private func point(_ e: InputEvent) -> CGPoint {
        guard let x = e.x, let y = e.y, x.isFinite, y.isFinite else { return cursor }
        return clamp(CGPoint(x: bounds.minX + CGFloat(min(max(x, 0), 1)) * bounds.width,
                             y: bounds.minY + CGFloat(min(max(y, 0), 1)) * bounds.height))
    }

    private func clamp(_ p: CGPoint) -> CGPoint {
        // maxX/maxY are exclusive edges: normalized 1.0 maps to the last pixel inside the display.
        let hiX = max(bounds.minX, bounds.maxX - 1), hiY = max(bounds.minY, bounds.maxY - 1)
        guard p.x.isFinite, p.y.isFinite else { return CGPoint(x: bounds.minX, y: bounds.minY) }
        return CGPoint(x: min(max(p.x, bounds.minX), hiX), y: min(max(p.y, bounds.minY), hiY))
    }

    private mutating func releaseHeld() -> [SyntheticEvent] {
        guard leftHeld else { return [] }
        leftHeld = false
        return [.leftUp(cursor, clickState: 0)]
    }

    private func finite(_ v: Double?) -> Double {
        guard let v, v.isFinite else { return 0 }
        return v
    }

    /// Whole points to scroll now; the fraction left over is carried in `carry` for the next scroll.
    private func scrollPoints(_ d: Double?, _ extent: Double, carry: inout Double) -> Int32 {
        let raw = finite(d) * extent
        guard raw.isFinite else { return 0 }
        let v = raw + carry
        let limit = 10000.0
        guard abs(v) <= limit else {
            carry = 0
            return Int32(v < 0 ? -limit : limit)
        }
        let whole = v.rounded()
        guard abs(whole) >= 1 else {
            carry = v
            return 0
        }
        carry = v - whole
        return Int32(whole)
    }
}
