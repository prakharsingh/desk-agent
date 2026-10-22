import CoreGraphics
import DisplayHelperCore
import Foundation

/// Posts `InputPlanner`'s synthetic mouse events to the HID event tap.
///
/// Called on the session queue (CGEvent posting is thread-safe). Needs PostEvent access; without it
/// `SessionController` never delivers input, so nothing is posted. Never logs per event: `posted`
/// is a debug counter only.
public final class InputInjector {
    private let source = CGEventSource(stateID: .hidSystemState)
    /// Events posted so far (debug aid; never logged per event).
    public private(set) var posted = 0

    public init() {}

    public func post(_ events: [SyntheticEvent]) {
        for event in Self.cgEvents(for: events, source: source, cursor: Self.currentCursor) {
            event.post(tap: .cghidEventTap)
            posted += 1
        }
    }

    /// The real pointer's current global location (scroll events are delivered under it; trackpad
    /// input re-syncs the planner's cursor to it). Nil if no event could be created.
    public static func currentCursor() -> CGPoint? {
        CGEvent(source: nil)?.location
    }

    /// Builds (does not post) the CGEvents for `events`. A scroll lands where the batch last put the
    /// pointer (the planner's `.move` to the two-finger centroid); without one, `cursor` is read
    /// (only for scroll events): the real pointer may lag a just-posted move, so it is not trusted then.
    static func cgEvents(for events: [SyntheticEvent], source: CGEventSource?,
                         cursor: () -> CGPoint?) -> [CGEvent] {
        var placed: CGPoint?
        return events.compactMap { event in
            switch event {
            case .move(let p), .leftDown(let p, _), .leftDragged(let p), .leftUp(let p, _),
                 .rightDown(let p), .rightUp(let p):
                placed = p
            case .scroll:
                break
            }
            let at = placed
            return cgEvent(for: event, source: source, cursor: { at ?? cursor() })
        }
    }

    static func cgEvent(for event: SyntheticEvent, source: CGEventSource?, cursor: () -> CGPoint?) -> CGEvent? {
        func mouse(_ type: CGEventType, _ p: CGPoint, _ button: CGMouseButton, clickState: Int64?) -> CGEvent? {
            guard let e = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: p,
                                  mouseButton: button) else { return nil }
            if let clickState { e.setIntegerValueField(.mouseEventClickState, value: clickState) }
            return e
        }
        switch event {
        case .move(let p):
            return mouse(.mouseMoved, p, .left, clickState: nil)
        case .leftDown(let p, let state):
            return mouse(.leftMouseDown, p, .left, clickState: state)
        case .leftDragged(let p):
            return mouse(.leftMouseDragged, p, .left, clickState: nil)
        case .leftUp(let p, let state):
            return mouse(.leftMouseUp, p, .left, clickState: state)
        case .rightDown(let p):
            return mouse(.rightMouseDown, p, .right, clickState: 1)
        case .rightUp(let p):
            return mouse(.rightMouseUp, p, .right, clickState: 1)
        case .scroll(let dx, let dy):
            // Sign conventions are verified manually on hardware (Task 4.3 brief).
            guard let e = CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2,
                                  wheel1: dy, wheel2: dx, wheel3: 0) else { return nil }
            if let at = cursor() { e.location = at }
            return e
        }
    }
}
