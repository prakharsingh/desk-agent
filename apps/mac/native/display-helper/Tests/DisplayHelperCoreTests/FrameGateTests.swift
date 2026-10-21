import Testing
@testable import DisplayHelperCore

@Suite struct FrameGateTests {
    let interval = 1.0 / 60.0

    /// Explicit setup: one sample arrived while the window was open, so a held frame exists
    /// and it has already been encoded.
    func gateWithEncodedHeldFrame(at t: Double = 0.5) -> FrameGate {
        var g = FrameGate(frameInterval: interval)
        let encodeNow = g.sampleArrived(at: t, canSend: true)
        #expect(encodeNow, "setup: a sample with the window open is encoded immediately")
        #expect(g.hasHeldFrame)
        return g
    }

    @Test func sampleWithOpenWindowEncodesImmediately() {
        var g = FrameGate(frameInterval: interval)
        #expect(!g.hasHeldFrame)
        let r1 = g.sampleArrived(at: 0, canSend: true)
        #expect(r1)
        #expect(g.hasHeldFrame)
        let r2 = g.unblocked(at: 0.1)
        #expect(r2 == false, "already encoded, nothing to resend")
    }

    @Test func encodesHeldFrameWhenUnblocked() {
        var g = FrameGate(frameInterval: interval)
        let r3 = g.sampleArrived(at: 0.0, canSend: false)
        #expect(r3 == false)
        #expect(g.hasHeldFrame)
        let r4 = g.unblocked(at: 0.05)
        #expect(r4 == true)
        let r5 = g.unblocked(at: 0.06)
        #expect(r5 == false)
    }

    @Test func unblockedWithoutAnyFrameDoesNothing() {
        var g = FrameGate(frameInterval: interval)
        let r6 = g.unblocked(at: 0.05)
        #expect(r6 == false)
    }

    @Test func newerBlockedSampleReplacesEncodedHeldFrame() {
        var g = gateWithEncodedHeldFrame()
        let r7 = g.sampleArrived(at: 0.6, canSend: false)
        #expect(r7 == false)
        let r8 = g.unblocked(at: 0.7)
        #expect(r8 == true, "the newest change must still reach the phone")
    }

    @Test func forcedIdrOnStaticScreenStillSends() {
        var g = gateWithEncodedHeldFrame()
        g.keyframeForced(at: 1.0)
        #expect(g.keyframePending)
        let r9 = g.tick(at: 1.02, canSend: true)
        #expect(r9 == true)
        #expect(!g.keyframePending, "the re-encode consumed the forced keyframe")
        let r10 = g.tick(at: 1.05, canSend: true)
        #expect(r10 == false, "only once per force")
    }

    @Test func forcedIdrUsesNewSampleWhenOneArrives() {
        var g = gateWithEncodedHeldFrame()
        g.keyframeForced(at: 1.0)
        #expect(g.keyframePending)
        let r11 = g.sampleArrived(at: 1.01, canSend: true)
        #expect(r11 == true, "the new sample is encoded as the IDR")
        #expect(!g.keyframePending)
        let r12 = g.tick(at: 1.02, canSend: true)
        #expect(r12 == false)
    }

    @Test func tickWaitsOneFrameInterval() {
        var g = gateWithEncodedHeldFrame()
        g.keyframeForced(at: 1.0)
        let r13 = g.tick(at: 1.005, canSend: true)
        #expect(r13 == false)
        #expect(g.keyframePending)
        let r14 = g.tick(at: 1.0 + interval + 0.001, canSend: true)
        #expect(r14 == true)
    }

    @Test func tickDoesNotSendWhileBlocked() {
        var g = gateWithEncodedHeldFrame()
        g.keyframeForced(at: 1.0)
        let r15 = g.tick(at: 1.02, canSend: false)
        #expect(r15 == false)
        #expect(g.keyframePending, "still pending until the window opens")
        let r16 = g.tick(at: 1.5, canSend: true)
        #expect(r16 == true)
    }

    @Test func tickWithoutHeldFrameKeepsKeyframePending() {
        var g = FrameGate(frameInterval: interval)
        g.keyframeForced(at: 1.0)
        let r17 = g.tick(at: 1.02, canSend: true)
        #expect(r17 == false)
        #expect(g.keyframePending)
        let r18 = g.sampleArrived(at: 1.1, canSend: true)
        #expect(r18 == true, "first sample goes out as the IDR")
        #expect(!g.keyframePending)
    }

    @Test func tickWithoutForceNeverReencodes() {
        var g = gateWithEncodedHeldFrame()
        let r19 = g.tick(at: 5.0, canSend: true)
        #expect(r19 == false)
    }

    @Test func blockedSampleAfterForceIsSentAsIdrByUnblocked() {
        var g = gateWithEncodedHeldFrame()
        g.keyframeForced(at: 1.0)
        let r20 = g.sampleArrived(at: 1.01, canSend: false)
        #expect(r20 == false)
        #expect(g.keyframePending)
        let r21 = g.tick(at: 1.03, canSend: false)
        #expect(r21 == false)
        let r22 = g.unblocked(at: 1.1)
        #expect(r22 == true)
        #expect(!g.keyframePending, "the held frame went out as the IDR")
    }
}
