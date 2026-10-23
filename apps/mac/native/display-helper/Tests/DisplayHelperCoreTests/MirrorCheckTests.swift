import Testing
@testable import DisplayHelperCore

@Suite struct MirrorCheckTests {
    let ours: UInt32 = 0xbd
    let lg: UInt32 = 0x1

    /// (display id, `CGDisplayMirrorsDisplay` of it) for every online display.
    func online(_ pairs: (UInt32, UInt32)...) -> [(id: UInt32, mirrors: UInt32)] { pairs.map { (id: $0.0, mirrors: $0.1) } }

    func why(_ v: MirrorVerdict) -> String? { if case .mirrored(let w) = v { return w } else { return nil } }

    @Test func anExtendedDisplayIsNotMirrored() {
        #expect(MirrorCheck.verdict(ours: ours, oursInMirrorSet: 0, oursMirrors: 0,
                                    online: online((lg, 0), (ours, 0))) == .notMirrored)
    }

    @Test func ourDisplayInAMirrorSetIsMirrored() {
        let v = MirrorCheck.verdict(ours: ours, oursInMirrorSet: 1, oursMirrors: 0, online: online((lg, 0), (ours, 0)))
        #expect(v.isMirrored)
        #expect(why(v) == "CGDisplayIsInMirrorSet(0x000000bd)=1")
    }

    @Test func anotherDisplayMirroringOursIsMirrored() {
        // F-mirror: the LG became the secondary of our display (we are the master).
        let v = MirrorCheck.verdict(ours: ours, oursInMirrorSet: 0, oursMirrors: 0, online: online((lg, ours), (ours, 0)))
        #expect(why(v) == "CGDisplayMirrorsDisplay(0x00000001)=0x000000bd")
    }

    @Test func ourDisplayMirroringAnotherIsMirrored() {
        let v = MirrorCheck.verdict(ours: ours, oursInMirrorSet: 0, oursMirrors: lg, online: online((lg, 0), (ours, lg)))
        #expect(why(v) == "CGDisplayMirrorsDisplay(0x000000bd)=0x00000001")
    }

    @Test func theRestoredSpareSetNamesEveryQueryThatFired() {
        // Probe run 1, spare 0xc6: listed, in a set, and the LG mirrors it (both genuine answers).
        let spare: UInt32 = 0xc6
        let v = MirrorCheck.verdict(ours: spare, oursInMirrorSet: 1, oursMirrors: 0, online: online((spare, 0), (lg, spare)))
        #expect(why(v) == "CGDisplayIsInMirrorSet(0x000000c6)=1, CGDisplayMirrorsDisplay(0x00000001)=0x000000c6")
    }

    @Test func aDisplayThisProcessDoesNotListYetIsUnknownNotMirrored() {
        // Probe run 1 / device run 7 (F-M1): right after Apply, CG in our process did not list the fresh
        // display yet and answered CGDisplayIsInMirrorSet = -1 and CGDisplayMirrorsDisplay = 0xffffffff
        // (error values, both non-zero) although WindowServer had added it extended.
        let v = MirrorCheck.verdict(ours: 0xc7, oursInMirrorSet: -1, oursMirrors: MirrorCheck.queryError,
                                    online: online((lg, 0)))
        #expect(v == .unknown)
        #expect(!v.isMirrored)
    }

    @Test func anUnlistedDisplayAnotherListedDisplayMirrorsIsStillMirrored() {
        // A genuine answer from a display we do list is evidence even while ours is not listed yet.
        let v = MirrorCheck.verdict(ours: ours, oursInMirrorSet: -1, oursMirrors: MirrorCheck.queryError,
                                    online: online((lg, ours)))
        #expect(why(v) == "CGDisplayMirrorsDisplay(0x00000001)=0x000000bd")
    }

    @Test func errorAnswersForAListedDisplayAreUnknown() {
        #expect(MirrorCheck.verdict(ours: ours, oursInMirrorSet: -1, oursMirrors: 0,
                                    online: online((lg, 0), (ours, 0))) == .unknown)
        #expect(MirrorCheck.verdict(ours: ours, oursInMirrorSet: 0, oursMirrors: MirrorCheck.queryError,
                                    online: online((lg, 0), (ours, MirrorCheck.queryError))) == .unknown)
    }

    @Test func aListedDisplayInASetIsMirroredEvenIfItsMirrorsAnswerIsAnError() {
        let v = MirrorCheck.verdict(ours: ours, oursInMirrorSet: 1, oursMirrors: MirrorCheck.queryError,
                                    online: online((lg, 0), (ours, MirrorCheck.queryError)))
        #expect(why(v) == "CGDisplayIsInMirrorSet(0x000000bd)=1")
    }

    @Test func anyInMirrorSetAnswerOtherThanZeroOrOneIsUnknown() {
        #expect(MirrorCheck.verdict(ours: ours, oursInMirrorSet: 2, oursMirrors: 0,
                                    online: online((lg, 0), (ours, 0))) == .unknown)
    }

    @Test func aMirrorBetweenTwoOtherDisplaysDoesNotCount() {
        let third: UInt32 = 0x2
        #expect(MirrorCheck.verdict(ours: ours, oursInMirrorSet: 0, oursMirrors: 0,
                                    online: online((lg, 0), (third, lg), (ours, 0))) == .notMirrored)
    }
}

@Suite struct MirrorSettlePollTests {
    @Test func aMirroredFirstCheckFailsAtOnce() {
        var poll = MirrorSettlePoll()
        #expect(poll.record(mirrored: true) == .mirrored)
    }

    @Test func clearOnlyAfterEveryCheckOfTheWindow() {
        var poll = MirrorSettlePoll()
        for _ in 1..<MirrorSettlePoll.checks { #expect(poll.record(mirrored: false) == .retry) }
        #expect(poll.record(mirrored: false) == .clear)
    }

    @Test func aMirrorOnTheLastCheckIsCaught() {
        var poll = MirrorSettlePoll()
        for _ in 1..<MirrorSettlePoll.checks { _ = poll.record(mirrored: false) }
        #expect(poll.record(mirrored: true) == .mirrored)
    }

    @Test func theWindowIsShortAndCoversWindowServersRestore() {
        // The saved set was applied ~9 ms after create (spare-mirror-report §1b); the window adds at
        // most a quarter second to a normal start.
        #expect(MirrorSettlePoll.window == MirrorSettlePoll.interval * Double(MirrorSettlePoll.checks - 1))
        #expect(MirrorSettlePoll.window >= 0.2 && MirrorSettlePoll.window <= 0.3)
    }
}
