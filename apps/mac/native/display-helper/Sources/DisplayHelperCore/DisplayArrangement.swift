import CoreGraphics

/// Where Desk Agent Phone sits in the user's display arrangement relative to the Mac's main display, so the phone
/// can tell the user which edge of the main screen to drag a window off (macOS 27 has no "Move to <display>"
/// Window-menu item, user report 3). Pure; the bounds are global display points (`CGDisplayBounds`, y down).
public enum DisplayArrangement {
    public enum Side: String, Equatable, Sendable {
        case left, right, above, below
    }

    /// `ours` relative to `main`, or nil when either is empty or they overlap (ours is the main display, or it is
    /// mirrored). A diagonal placement picks the axis with the wider gap.
    public static func side(of ours: CGRect, main: CGRect) -> Side? {
        guard !ours.isEmpty, !main.isEmpty else { return nil }
        let gapLeft = main.minX - ours.maxX, gapRight = ours.minX - main.maxX
        let gapAbove = main.minY - ours.maxY, gapBelow = ours.minY - main.maxY
        let horizontal: (Side, CGFloat)? = gapLeft >= 0 ? (.left, gapLeft) : gapRight >= 0 ? (.right, gapRight) : nil
        let vertical: (Side, CGFloat)? = gapAbove >= 0 ? (.above, gapAbove) : gapBelow >= 0 ? (.below, gapBelow) : nil
        switch (horizontal, vertical) {
        case let (h?, v?): return h.1 >= v.1 ? h.0 : v.0
        case let (h?, nil): return h.0
        case let (nil, v?): return v.0
        case (nil, nil): return nil
        }
    }
}
