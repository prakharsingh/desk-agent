import Testing
@testable import DisplayHelperCore

@Suite struct ModeActivationTests {
    let applied = DisplayModes.modes(surfaceW: 2340, surfaceH: 1080)
    // macOS 27 refuses to desktop-activate small point sizes: 936x432 is NOT usable, 1170x540 and 1560x720 are.
    let hi936 = DisplayModeInfo(widthPoints: 936, heightPoints: 432, pixelWidth: 1872, pixelHeight: 864, usableForDesktop: false)
    let hi1170 = DisplayModeInfo(widthPoints: 1170, heightPoints: 540, pixelWidth: 2340, pixelHeight: 1080)
    let hi1560 = DisplayModeInfo(widthPoints: 1560, heightPoints: 720, pixelWidth: 3120, pixelHeight: 1440)
    let lowRes1872 = DisplayModeInfo(widthPoints: 1872, heightPoints: 864, pixelWidth: 1872, pixelHeight: 864)
    let lowRes936 = DisplayModeInfo(widthPoints: 936, heightPoints: 432, pixelWidth: 936, pixelHeight: 432, usableForDesktop: false)

    var available: [DisplayModeInfo] { [lowRes1872, lowRes936, hi1560, hi1170, hi936] }

    @Test func activatesFirstUsableAppliedHiDPIModeWhenCurrentIsLowRes() {
        // applied order: 936, 780, 1170, 1560, 2340 -> 936 unusable, 780 absent, 1170 wins.
        #expect(ModeActivation.decide(current: lowRes1872, available: available, applied: applied) == .activate(hi1170))
    }

    @Test func keepsAHiDPIModeOfOursThatMacOSRestored() {
        #expect(ModeActivation.decide(current: hi1560, available: available, applied: applied) == .keep(hi1560))
    }

    @Test func activatesWhenNoCurrentMode() {
        #expect(ModeActivation.decide(current: nil, available: available, applied: applied) == .activate(hi1170))
    }

    @Test func emptyModeListIsNoneAvailable() {
        #expect(ModeActivation.decide(current: lowRes1872, available: [], applied: applied) == .noneAvailable)
    }

    @Test func laggingListBecomesAvailableOnALaterPoll() {
        // First poll: macOS has not published our modes yet. Later poll: the same call now succeeds.
        #expect(ModeActivation.decide(current: lowRes1872, available: [lowRes1872], applied: applied) == .noneAvailable)
        #expect(ModeActivation.decide(current: lowRes1872, available: available, applied: applied) == .activate(hi1170))
    }

    @Test func noneAvailableWhenOnlyUnusableOrLowResVariantsExist() {
        #expect(ModeActivation.decide(current: lowRes1872, available: [lowRes1872, lowRes936, hi936], applied: applied) == .noneAvailable)
    }

    @Test func doesNotKeepAHiDPIModeThatIsNotOurs() {
        let foreign = DisplayModeInfo(widthPoints: 800, heightPoints: 600, pixelWidth: 1600, pixelHeight: 1200)
        #expect(ModeActivation.decide(current: foreign, available: available + [foreign], applied: applied) == .activate(hi1170))
    }

    @Test func keepRequiresMatchingHeightNotJustWidth() {
        // Same point width as an applied mode (1170) but a different height: not ours, so activate.
        let sameWidthOtherHeight = DisplayModeInfo(widthPoints: 1170, heightPoints: 700, pixelWidth: 2340, pixelHeight: 1400)
        #expect(ModeActivation.decide(current: sameWidthOtherHeight, available: available, applied: applied) == .activate(hi1170))
    }

    @Test func keepRequiresHiDPIPixelScale() {
        // 1x mode with an applied point size is not a HiDPI mode of ours.
        let oneX1170 = DisplayModeInfo(widthPoints: 1170, heightPoints: 540, pixelWidth: 1170, pixelHeight: 540)
        #expect(ModeActivation.decide(current: oneX1170, available: available, applied: applied) == .activate(hi1170))
    }
}

/// The retry/give-up bookkeeping of the asynchronous activation poll (VirtualDisplayController).
@Suite struct ActivationPollTests {
    @Test func budgetIsThirtyAttemptsOver3s() {
        #expect(ActivationPoll.maxAttempts == 30)
        #expect(abs(Double(ActivationPoll.maxAttempts) * ActivationPoll.interval - 3.0) < 1e-9)
    }

    @Test func keptOrSwitchedFinishesAtOnce() {
        var a = ActivationPoll()
        #expect(a.record(.kept) == .finished)
        var b = ActivationPoll()
        #expect(b.record(.switchSucceeded) == .finished)
    }

    @Test func nothingListedRetriesThenFailsUnavailableOnTheLastAttempt() {
        var p = ActivationPoll()
        for _ in 1..<ActivationPoll.maxAttempts { #expect(p.record(.notListed) == .retry) }
        #expect(p.record(.notListed) == .failed(.modeUnavailable))
    }

    @Test func aFailedSwitchIsReportedWithTheLastError() {
        var p = ActivationPoll()
        #expect(p.record(.switchFailed(-1)) == .retry)
        #expect(p.record(.switchFailed(1001)) == .retry)
        for _ in 3..<ActivationPoll.maxAttempts { #expect(p.record(.notListed) == .retry) }
        #expect(p.record(.notListed) == .failed(.modeSwitchFailed(1001)))
    }

    /// F1: macOS kept the display out of the desktop (Control Center "independent output" persisted
    /// for this vendor/product/serial) for the whole window.
    @Test func offlineForTheWholeWindowFailsDisplayOffline() {
        var p = ActivationPoll()
        for _ in 1..<ActivationPoll.maxAttempts { #expect(p.record(.offline) == .retry) }
        #expect(p.record(.offline) == .failed(.displayOffline))
    }

    @Test func onlineOnceButNeverListedStillFailsModeUnavailable() {
        var p = ActivationPoll()
        #expect(p.record(.notListed) == .retry)
        for _ in 2..<ActivationPoll.maxAttempts { #expect(p.record(.offline) == .retry) }
        #expect(p.record(.offline) == .failed(.modeUnavailable))
    }

    @Test func offlineThenOnlineAndSwitchedFinishes() {
        var p = ActivationPoll()
        for _ in 0..<5 { #expect(p.record(.offline) == .retry) }
        #expect(p.record(.switchSucceeded) == .finished)
    }

    @Test func aLateSuccessFinishes() {
        var p = ActivationPoll()
        for _ in 0..<10 { #expect(p.record(.notListed) == .retry) }
        #expect(p.record(.switchFailed(1001)) == .retry)
        #expect(p.record(.switchSucceeded) == .finished)
    }
}
