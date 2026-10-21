import Testing
@testable import DisplayHelperCore

@Suite struct ModeActivationTests {
    let applied = DisplayModes.modes(surfaceW: 2340, surfaceH: 1080)
    let hi936 = DisplayModeInfo(widthPoints: 936, heightPoints: 432, pixelWidth: 1872, pixelHeight: 864)
    let hi1170 = DisplayModeInfo(widthPoints: 1170, heightPoints: 540, pixelWidth: 2340, pixelHeight: 1080)
    let lowRes1872 = DisplayModeInfo(widthPoints: 1872, heightPoints: 864, pixelWidth: 1872, pixelHeight: 864)
    let lowRes936 = DisplayModeInfo(widthPoints: 936, heightPoints: 432, pixelWidth: 936, pixelHeight: 432)

    // macOS refuses to desktop-activate small point sizes (observed: 936x432 is not usable, 1170x540 is).
    var hi936Unusable: DisplayModeInfo {
        DisplayModeInfo(widthPoints: 936, heightPoints: 432, pixelWidth: 1872, pixelHeight: 864, usableForDesktop: false)
    }

    var available: [DisplayModeInfo] { [lowRes1872, lowRes936, hi1170, hi936] }

    @Test func activatesPreferredHiDPIWhenCurrentIsLowRes() {
        #expect(ModeActivation.modeToActivate(current: lowRes1872, available: available, applied: applied) == hi936)
    }

    @Test func keepsAHiDPIModeOfOursThatMacOSRestored() {
        #expect(ModeActivation.modeToActivate(current: hi1170, available: available, applied: applied) == nil)
    }

    @Test func activatesWhenNoCurrentMode() {
        #expect(ModeActivation.modeToActivate(current: nil, available: available, applied: applied) == hi936)
    }

    @Test func ignoresLowResModeWithTheSamePointWidth() {
        // lowRes936 shares the preferred point width but is not 2x; it must never be chosen.
        let r = ModeActivation.modeToActivate(current: lowRes1872, available: [lowRes936, lowRes1872], applied: applied)
        #expect(r == nil)
    }

    @Test func replacesAHiDPIModeThatIsNotInOurAppliedList() {
        let foreign = DisplayModeInfo(widthPoints: 800, heightPoints: 600, pixelWidth: 1600, pixelHeight: 1200)
        #expect(ModeActivation.modeToActivate(current: foreign, available: available + [foreign], applied: applied) == hi936)
    }

    @Test func fallsBackToNextAppliedModeWhenPreferredIsNotUsable() {
        let avail = [lowRes1872, hi936Unusable, hi1170]
        #expect(ModeActivation.modeToActivate(current: lowRes1872, available: avail, applied: applied) == hi1170)
    }

    @Test func returnsNilWhenNoAppliedHiDPIModeIsUsable() {
        #expect(ModeActivation.modeToActivate(current: lowRes1872, available: [lowRes1872, hi936Unusable], applied: applied) == nil)
    }
}
