import Foundation
import CoreGraphics
import Testing
@testable import DisplayHelperCore

@Suite struct InputPlannerTests {
    static let bounds = CGRect(x: 1512, y: 0, width: 936, height: 432)

    func make(cursor: CGPoint = CGPoint(x: 1980, y: 216)) -> InputPlanner {
        InputPlanner(bounds: Self.bounds, cursor: cursor)
    }

    func click(_ x: Double, _ y: Double) -> InputEvent { InputEvent(kind: .click, x: x, y: y) }

    @Test func clickMapsNormalizedCoordinatesIntoDisplayBounds() {
        var p = make()
        let pt = CGPoint(x: 1980, y: 216)
        #expect(p.plan(click(0.5, 0.5), at: 0) == [.move(pt), .leftDown(pt, clickState: 1), .leftUp(pt, clickState: 1)])
    }

    @Test func clickCoordinatesAreClampedToUnitRange() {
        var p = make()
        let pt = CGPoint(x: 1512 + 935, y: 0)
        #expect(p.plan(click(5, -3), at: 0).first == .move(pt))
    }

    @Test func secondClickWithin05sAnd16ptIsADoubleClick() {
        var p = make()
        _ = p.plan(click(0.5, 0.5), at: 10)
        let out = p.plan(click(0.5, 0.5), at: 10.4)
        #expect(out.contains(.leftDown(CGPoint(x: 1980, y: 216), clickState: 2)))
    }

    @Test func slowSecondClickIsASingleClick() {
        var p = make()
        _ = p.plan(click(0.5, 0.5), at: 10)
        let out = p.plan(click(0.5, 0.5), at: 10.6)
        #expect(out.contains(.leftDown(CGPoint(x: 1980, y: 216), clickState: 1)))
    }

    @Test func farSecondClickIsASingleClick() {
        var p = make()
        _ = p.plan(click(0.5, 0.5), at: 10)
        // 0.02 * 936 = 18.72 pt away (> 16)
        let out = p.plan(click(0.52, 0.5), at: 10.1)
        #expect(out.contains { if case .leftDown(_, let n) = $0 { return n == 1 } else { return false } })
    }

    @Test func doubleClickDistanceIsEuclidean() {
        var p = make()
        _ = p.plan(click(0.5, 0.5), at: 10)
        // 12pt in x and 12pt in y => 16.97pt > 16
        let dx = 12.0 / 936, dy = 12.0 / 432
        let out = p.plan(click(0.5 + dx, 0.5 + dy), at: 10.1)
        #expect(out.contains { if case .leftDown(_, let n) = $0 { return n == 1 } else { return false } })
    }

    /// I2: finger taps land several points apart; Contract E slop is 16 pt (was 4).
    @Test func doubleClickSlopDefaultsTo16pt() {
        var p = make()
        _ = p.plan(click(0.5, 0.5), at: 10)
        // 15 pt away: a double-click at 16 pt slop, a single click at the old 4 pt.
        let out = p.plan(click(0.5 + 15.0 / 936, 0.5), at: 10.1)
        #expect(out.contains { if case .leftDown(_, let n) = $0 { return n == 2 } else { return false } })
    }

    @Test func thirdQuickClickIsATripleClickCappedAtThree() {
        var p = make()
        var states: [Int64] = []
        for i in 0..<4 {
            let out = p.plan(click(0.5, 0.5), at: 10 + Double(i) * 0.2)
            if case .leftDown(_, let n)? = out.dropFirst().first { states.append(n) }
        }
        #expect(states == [1, 2, 3, 3])
    }

    @Test func intervalIsMeasuredFromThePreviousClick() {
        var p = make()
        _ = p.plan(click(0.5, 0.5), at: 10)
        _ = p.plan(click(0.5, 0.5), at: 10.4)
        let out = p.plan(click(0.5, 0.5), at: 10.8) // 0.8 from first, 0.4 from second
        #expect(out.contains(.leftDown(CGPoint(x: 1980, y: 216), clickState: 3)))
    }

    @Test func rightClick() {
        var p = make()
        let pt = CGPoint(x: 1512 + 936 * 0.25, y: 432 * 0.75)
        #expect(p.plan(InputEvent(kind: .rightClick, x: 0.25, y: 0.75), at: 0) == [.move(pt), .rightDown(pt), .rightUp(pt)])
    }

    @Test func rightClickAndDragStartResetTheDoubleClickChain() {
        var p = make()
        _ = p.plan(click(0.5, 0.5), at: 10)
        _ = p.plan(InputEvent(kind: .rightClick, x: 0.5, y: 0.5), at: 10.1)
        var out = p.plan(click(0.5, 0.5), at: 10.2)
        #expect(out.contains(.leftDown(CGPoint(x: 1980, y: 216), clickState: 1)))

        _ = p.plan(InputEvent(kind: .dragStart, x: 0.5, y: 0.5), at: 10.3)
        _ = p.plan(InputEvent(kind: .dragEnd, x: 0.5, y: 0.5), at: 10.35)
        out = p.plan(click(0.5, 0.5), at: 10.4)
        #expect(out.contains(.leftDown(CGPoint(x: 1980, y: 216), clickState: 1)))
    }

    @Test func nonQuickClickResetsTheChain() {
        var p = make()
        _ = p.plan(click(0.5, 0.5), at: 10)
        _ = p.plan(click(0.5, 0.5), at: 10.2)      // state 2
        _ = p.plan(click(0.9, 0.9), at: 10.3)      // far: state 1, new chain
        let out = p.plan(click(0.5, 0.5), at: 10.4) // far from previous: 1
        #expect(out.contains(.leftDown(CGPoint(x: 1980, y: 216), clickState: 1)))
    }

    @Test func dragSequence() {
        var p = make()
        let a = CGPoint(x: 1512 + 93.6, y: 43.2)
        let b = CGPoint(x: 1512 + 468, y: 216)
        let c = CGPoint(x: 1512 + 935, y: 431)
        #expect(p.plan(InputEvent(kind: .dragStart, x: 0.1, y: 0.1), at: 0) == [.move(a), .leftDown(a, clickState: 1)])
        #expect(p.plan(InputEvent(kind: .dragMove, x: 0.5, y: 0.5), at: 0.1) == [.leftDragged(b)])
        #expect(p.plan(InputEvent(kind: .dragEnd, x: 1, y: 1), at: 0.2) == [.leftUp(c, clickState: 1)])
        #expect(p.teardown().isEmpty)
    }

    @Test func scrollWhileTheButtonIsHeldReleasesItWithClickState0First() {
        var p = make()
        _ = p.plan(InputEvent(kind: .dragStart, x: 0.5, y: 0.5), at: 0)
        let out = p.plan(InputEvent(kind: .scroll, dx: 0.0, dy: 0.1), at: 0.1)
        #expect(out == [.leftUp(CGPoint(x: 1980, y: 216), clickState: 0), .scroll(dxPoints: 0, dyPoints: 43)])
        #expect(p.teardown().isEmpty)
    }

    @Test func scrollWithoutHeldButtonJustScrolls() {
        var p = make()
        let out = p.plan(InputEvent(kind: .scroll, dx: -0.1, dy: -0.05), at: 0)
        #expect(out == [.scroll(dxPoints: -94, dyPoints: -22)])
    }

    /// I1: absolute-mode scroll carries the two-finger centroid; the scroll lands there.
    @Test func scrollWithCoordinatesMovesThereFirst() {
        var p = make()
        let at = CGPoint(x: 1512 + 234, y: 324)
        let out = p.plan(InputEvent(kind: .scroll, x: 0.25, y: 0.75, dx: 0, dy: 0.1), at: 0)
        #expect(out == [.move(at), .scroll(dxPoints: 0, dyPoints: 43)])
        // The cursor followed: a coordinate-less click acts there.
        #expect(p.plan(InputEvent(kind: .click), at: 1).first == .move(at))
    }

    @Test func scrollWithCoordinatesReleasesAHeldButtonBeforeMoving() {
        var p = make()
        _ = p.plan(InputEvent(kind: .dragStart, x: 0.5, y: 0.5), at: 0)
        let at = CGPoint(x: 1512 + 234, y: 324)
        let out = p.plan(InputEvent(kind: .scroll, x: 0.25, y: 0.75, dx: 0, dy: 0.1), at: 0.1)
        #expect(out == [.leftUp(CGPoint(x: 1980, y: 216), clickState: 0), .move(at), .scroll(dxPoints: 0, dyPoints: 43)])
    }

    @Test func scrollWithUnusableCoordinatesScrollsAtTheCursor() {
        var p = make()
        #expect(p.plan(InputEvent(kind: .scroll, x: .nan, y: 0.5, dx: 0, dy: 0.1), at: 0) == [.scroll(dxPoints: 0, dyPoints: 43)])
        #expect(p.plan(InputEvent(kind: .scroll, x: 0.5, dx: 0, dy: 0.1), at: 0.1) == [.scroll(dxPoints: 0, dyPoints: 43)])
    }

    /// M1: sub-point scrolls accumulate instead of rounding away.
    @Test func slowScrollsAccumulateTheirFractions() {
        var p = make()
        var total: Int32 = 0
        for i in 0..<10 {
            for e in p.plan(InputEvent(kind: .scroll, dx: 0, dy: 0.4 / 432), at: Double(i) * 0.01) {
                if case .scroll(let dx, let dy) = e { #expect(dx == 0); total += dy }
            }
        }
        #expect(total == 4)
    }

    @Test func slowScrollsAccumulatePerAxisAndNegatively() {
        var p = make()
        var total = (x: Int32(0), y: Int32(0))
        for i in 0..<10 {
            for e in p.plan(InputEvent(kind: .scroll, dx: -0.4 / 936, dy: 0.3 / 432), at: Double(i) * 0.01) {
                if case .scroll(let dx, let dy) = e { total.x += dx; total.y += dy }
            }
        }
        #expect(total.x == -4)
        #expect(total.y == 3)
    }

    @Test func aNonScrollEventClearsTheScrollRemainder() {
        var p = make()
        #expect(p.plan(InputEvent(kind: .scroll, dx: 0, dy: 0.4 / 432), at: 0).isEmpty)
        _ = p.plan(InputEvent(kind: .move, dx: 0, dy: 0), at: 0.1)
        // Without the reset, 0.4 + 0.4 = 0.8 would round to 1.
        #expect(p.plan(InputEvent(kind: .scroll, dx: 0, dy: 0.4 / 432), at: 0.2).isEmpty)
    }

    @Test func scrollRoundingToZeroEmitsNothingAndKeepsTheButtonHeld() {
        var p = make()
        _ = p.plan(InputEvent(kind: .dragStart, x: 0.5, y: 0.5), at: 0)
        #expect(p.plan(InputEvent(kind: .scroll, dx: 0.0001, dy: 0.0001), at: 0.1).isEmpty)
        #expect(p.teardown() == [.leftUp(CGPoint(x: 1980, y: 216), clickState: 0)])
    }

    @Test func trackpadMoveAppliesGainAndClampsToBounds() {
        var p = make()
        // 0.1 * 936 * 1.5 = 140.4 ; 0.1 * 432 * 1.5 = 64.8
        #expect(p.plan(InputEvent(kind: .move, dx: 0.1, dy: 0.1), at: 0) == [.move(CGPoint(x: 1980 + 140.4, y: 216 + 64.8))])
        #expect(p.plan(InputEvent(kind: .move, dx: 5, dy: 5), at: 0.1) == [.move(CGPoint(x: 2447, y: 431))])
        #expect(p.plan(InputEvent(kind: .move, dx: -50, dy: -50), at: 0.2) == [.move(CGPoint(x: 1512, y: 0))])
    }

    @Test func coordinateLessClickActsAtTheCursor() {
        var p = make(cursor: CGPoint(x: 1600, y: 100))
        let pt = CGPoint(x: 1600, y: 100)
        #expect(p.plan(InputEvent(kind: .click), at: 0) == [.move(pt), .leftDown(pt, clickState: 1), .leftUp(pt, clickState: 1)])
        #expect(p.plan(InputEvent(kind: .rightClick), at: 5) == [.move(pt), .rightDown(pt), .rightUp(pt)])
    }

    @Test func cursorFollowsTheLastEmittedPoint() {
        var p = make()
        _ = p.plan(click(0, 0), at: 0)
        #expect(p.plan(InputEvent(kind: .rightClick), at: 5) ==
                [.move(CGPoint(x: 1512, y: 0)), .rightDown(CGPoint(x: 1512, y: 0)), .rightUp(CGPoint(x: 1512, y: 0))])
        _ = p.plan(InputEvent(kind: .dragStart, x: 1, y: 1), at: 6)
        #expect(p.teardown() == [.leftUp(CGPoint(x: 2447, y: 431), clickState: 0)])
    }

    @Test func updateBoundsClampsTheCursor() {
        var p = make(cursor: CGPoint(x: 2400, y: 400))
        p.updateBounds(CGRect(x: 0, y: 0, width: 100, height: 50))
        #expect(p.plan(InputEvent(kind: .click), at: 0).first == .move(CGPoint(x: 99, y: 49)))
    }

    @Test func updateBoundsAffectsSubsequentMapping() {
        var p = make()
        p.updateBounds(CGRect(x: 0, y: 0, width: 200, height: 100))
        #expect(p.plan(click(0.5, 0.5), at: 0).first == .move(CGPoint(x: 100, y: 50)))
    }

    @Test func teardownReleasesAHeldLeftButton() {
        var p = make()
        _ = p.plan(InputEvent(kind: .dragStart, x: 0.5, y: 0.5), at: 0)
        _ = p.plan(InputEvent(kind: .dragMove, x: 0.6, y: 0.5), at: 0.1)
        let pt = CGPoint(x: 1512 + 936 * 0.6, y: 216)
        #expect(p.teardown() == [.leftUp(pt, clickState: 0)])
        #expect(p.teardown().isEmpty)
    }

    @Test func teardownIsEmptyWhenNothingIsHeld() {
        var p = make()
        _ = p.plan(click(0.5, 0.5), at: 0)
        #expect(p.teardown().isEmpty)
    }

    @Test func unknownEventsAreIgnored() {
        var p = make()
        #expect(p.plan(InputEvent(kind: .unknown), at: 0).isEmpty)
    }

    @Test func hugeScrollIsClampedAndNonFiniteInputIsHarmless() {
        var p = make()
        #expect(p.plan(InputEvent(kind: .scroll, dx: 0, dy: 1e12), at: 0) == [.scroll(dxPoints: 0, dyPoints: 10000)])
        #expect(p.plan(InputEvent(kind: .scroll, dx: -.infinity, dy: 0), at: 0) .isEmpty)
        #expect(p.plan(InputEvent(kind: .scroll, dx: .nan, dy: .nan), at: 0).isEmpty)
        #expect(p.plan(InputEvent(kind: .move, dx: .nan, dy: .infinity), at: 0) == [.move(CGPoint(x: 1980, y: 216))])
        let out = p.plan(InputEvent(kind: .click, x: .nan, y: 0.5), at: 1)
        #expect(out.first == .move(CGPoint(x: 1980, y: 216)))
    }

    @Test func dragStartWhileHeldReleasesFirst() {
        var p = make()
        _ = p.plan(InputEvent(kind: .dragStart, x: 0.5, y: 0.5), at: 0)
        let out = p.plan(InputEvent(kind: .dragStart, x: 0.0, y: 0.0), at: 1)
        let o = CGPoint(x: 1512, y: 0)
        #expect(out == [.leftUp(CGPoint(x: 1980, y: 216), clickState: 0), .move(o), .leftDown(o, clickState: 1)])
    }

    @Test func clickAndRightClickWhileHeldReleaseFirst() {
        var p = make()
        _ = p.plan(InputEvent(kind: .dragStart, x: 0.5, y: 0.5), at: 0)
        var out = p.plan(click(0.5, 0.5), at: 1)
        #expect(out.first == .leftUp(CGPoint(x: 1980, y: 216), clickState: 0))
        #expect(out.count == 4)
        #expect(p.teardown().isEmpty)
        _ = p.plan(InputEvent(kind: .dragStart, x: 0.5, y: 0.5), at: 2)
        out = p.plan(InputEvent(kind: .rightClick, x: 0.5, y: 0.5), at: 3)
        #expect(out.first == .leftUp(CGPoint(x: 1980, y: 216), clickState: 0))
        #expect(out.count == 4)
        #expect(p.teardown().isEmpty)
    }

    @Test func dragEndAndDragMoveWithoutHeldButtonAreHarmless() {
        var p = make()
        #expect(p.plan(InputEvent(kind: .dragEnd, x: 0.5, y: 0.5), at: 0).isEmpty)
        // A stray dragMove becomes a plain move (and updates the cursor), never a drag.
        #expect(p.plan(InputEvent(kind: .dragMove, x: 0.0, y: 0.0), at: 0) == [.move(CGPoint(x: 1512, y: 0))])
    }

    @Test func clickTimeGoingBackwardsIsNotADoubleClick() {
        var p = make()
        _ = p.plan(click(0.5, 0.5), at: 10)
        let out = p.plan(click(0.5, 0.5), at: 9.9)
        #expect(out.contains(.leftDown(CGPoint(x: 1980, y: 216), clickState: 1)))
    }

    // MARK: syncCursor (the real pointer may have moved since the last planned event)

    @Test func syncCursorAdoptsAPointInsideTheBounds() {
        var p = make()
        p.syncCursor(CGPoint(x: 1600, y: 100))
        // A trackpad tap (no x/y) acts at the adopted pointer, not the stale planner cursor.
        let pt = CGPoint(x: 1600, y: 100)
        #expect(p.plan(InputEvent(kind: .click), at: 0) == [.move(pt), .leftDown(pt, clickState: 1), .leftUp(pt, clickState: 1)])
    }

    @Test func syncCursorIgnoresAPointOutsideTheBounds() {
        var p = make()
        p.syncCursor(CGPoint(x: 100, y: 100))          // on the Mac's main display
        p.syncCursor(CGPoint(x: 1512 + 936, y: 216))   // exclusive right edge
        p.syncCursor(CGPoint(x: CGFloat.nan, y: 216))
        let old = CGPoint(x: 1980, y: 216)
        #expect(p.plan(InputEvent(kind: .rightClick), at: 0) == [.move(old), .rightDown(old), .rightUp(old)])
    }

    @Test func syncedCursorIsTheTrackpadMoveOrigin() {
        var p = make()
        p.syncCursor(CGPoint(x: 1600, y: 100))
        // dx 0.01 × 936 × gain 1.5 = 14.04
        guard case .move(let pt)? = p.plan(InputEvent(kind: .move, dx: 0.01, dy: 0), at: 0).first else {
            Issue.record("expected a move"); return
        }
        #expect(abs(pt.x - 1614.04) < 0.001)
        #expect(pt.y == 100)
    }

    @Test func onlyTrackpadRelativeEventsUseTheCursor() {
        #expect(InputPlanner.actsAtCursor(InputEvent(kind: .move, dx: 0.1, dy: 0)))
        #expect(InputPlanner.actsAtCursor(InputEvent(kind: .click)))
        #expect(InputPlanner.actsAtCursor(InputEvent(kind: .rightClick)))
        #expect(!InputPlanner.actsAtCursor(InputEvent(kind: .click, x: 0.5, y: 0.5)))
        #expect(!InputPlanner.actsAtCursor(InputEvent(kind: .rightClick, x: 0.5, y: 0.5)))
        #expect(!InputPlanner.actsAtCursor(InputEvent(kind: .dragStart, x: 0.5, y: 0.5)))
        #expect(!InputPlanner.actsAtCursor(InputEvent(kind: .scroll, dx: 0, dy: 0.1)))
    }
}
