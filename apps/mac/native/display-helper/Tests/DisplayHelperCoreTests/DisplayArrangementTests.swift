import CoreGraphics
import Testing
@testable import DisplayHelperCore

@Suite struct DisplayArrangementTests {
    let main = CGRect(x: 0, y: 0, width: 1512, height: 982)

    @Test func leftOfMain() {
        #expect(DisplayArrangement.side(of: CGRect(x: -540, y: -50, width: 540, height: 1130), main: main) == .left)
    }

    @Test func rightOfMain() {
        #expect(DisplayArrangement.side(of: CGRect(x: 1512, y: 100, width: 540, height: 1130), main: main) == .right)
    }

    @Test func aboveMain() {
        #expect(DisplayArrangement.side(of: CGRect(x: 200, y: -540, width: 1130, height: 540), main: main) == .above)
    }

    @Test func belowMain() {
        #expect(DisplayArrangement.side(of: CGRect(x: 200, y: 982, width: 1130, height: 540), main: main) == .below)
    }

    @Test func diagonalPicksTheWiderGap() {
        // Mostly left (gap 300) and a little above (gap 10).
        #expect(DisplayArrangement.side(of: CGRect(x: -840, y: -550, width: 540, height: 540), main: main) == .left)
        // Mostly below.
        #expect(DisplayArrangement.side(of: CGRect(x: 1520, y: 1500, width: 540, height: 540), main: main) == .below)
    }

    @Test func overlappingOrMainItselfHasNoSide() {
        #expect(DisplayArrangement.side(of: main, main: main) == nil)
        #expect(DisplayArrangement.side(of: CGRect(x: 100, y: 100, width: 540, height: 540), main: main) == nil)
        #expect(DisplayArrangement.side(of: .zero, main: main) == nil)
        #expect(DisplayArrangement.side(of: CGRect(x: -540, y: 0, width: 540, height: 900), main: .zero) == nil)
    }

    @Test func wireNames() {
        #expect(DisplayArrangement.Side.left.rawValue == "left")
        #expect(DisplayArrangement.Side.right.rawValue == "right")
        #expect(DisplayArrangement.Side.above.rawValue == "above")
        #expect(DisplayArrangement.Side.below.rawValue == "below")
    }
}
