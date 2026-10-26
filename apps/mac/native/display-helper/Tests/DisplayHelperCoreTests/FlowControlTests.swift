import Testing
@testable import DisplayHelperCore

@Suite struct FlowControlTests {
    func sent(_ n: Int, _ f: inout FlowControl, at t: Double = 0) {
        for _ in 0..<n { _ = f.nextSeq(sentAt: t) }
    }

    @Test func seqStartsAtOneAndIncrements() {
        var f = FlowControl()
        #expect(f.nextSeq(sentAt: 0) == 1)
        #expect(f.nextSeq(sentAt: 0) == 2)
        #expect(f.lastSent == 2)
    }

    @Test func flowControlBlocksWhenMoreThanTwoUnacked() {
        var f = FlowControl()
        sent(2, &f)
        #expect(f.canSend)
        sent(1, &f)
        #expect(!f.canSend)
        #expect(f.ack(1, at: 0.1) == true)
        #expect(f.canSend)
    }

    @Test func ackThatDoesNotReopenReturnsFalse() {
        var f = FlowControl()
        sent(4, &f)
        #expect(f.ack(1, at: 0.1) == false)
        #expect(!f.canSend)
    }

    @Test func staleAckDoesNotRewind() {
        var f = FlowControl()
        sent(3, &f)
        _ = f.ack(3, at: 0.1)
        _ = f.ack(2, at: 0.2)
        #expect(f.acked == 3)
    }

    @Test func ackAboveLastSentIsIgnored() {
        var f = FlowControl()
        sent(2, &f)
        #expect(f.ack(99, at: 0.1) == false)
        #expect(f.acked == 0)
        #expect(f.canSend)
    }

    @Test func ackBeforeAnySendIsIgnored() {
        var f = FlowControl()
        #expect(f.ack(0, at: 0) == false)
        #expect(f.acked == 0)
    }

    @Test func resetClearsWindowButKeepsCounter() {
        var f = FlowControl()
        sent(3, &f)
        #expect(!f.canSend)
        f.reset()
        #expect(f.canSend)
        #expect(f.acked == 3)
        #expect(f.nextSeq(sentAt: 1) == 4)
    }

    @Test func stallDetectedAfterOneSecond() {
        var f = FlowControl()
        sent(3, &f, at: 10.0)
        #expect(!f.isStalled(at: 10.9))
        #expect(f.isStalled(at: 11.01))
        _ = f.ack(1, at: 11.02)
        #expect(!f.isStalled(at: 20))
    }

    @Test func notStalledWhenWindowOpen() {
        var f = FlowControl()
        sent(2, &f, at: 0)
        #expect(!f.isStalled(at: 100))
    }

    @Test func resetClearsStall() {
        var f = FlowControl()
        sent(3, &f, at: 0)
        #expect(f.isStalled(at: 2))
        f.reset()
        #expect(!f.isStalled(at: 2))
    }

    @Test func blockedAgainRestartsStallClock() {
        var f = FlowControl()
        sent(3, &f, at: 0)
        _ = f.ack(1, at: 0.5)          // reopens
        _ = f.nextSeq(sentAt: 5.0)      // seq 4: unacked 3 -> blocked again at 5.0
        #expect(!f.isStalled(at: 5.9))
        #expect(f.isStalled(at: 6.01))
    }

    @Test func latencyPercentilesEmpty() {
        let f = FlowControl()
        let p = f.latencyPercentiles()
        #expect(p.p50 == 0)
        #expect(p.p95 == 0)
    }

    @Test func latencyPercentilesFromSentAt() {
        var f = FlowControl(maxUnacked: 1000)
        for i in 1...100 { _ = f.nextSeq(sentAt: Double(i)) }
        // seq i is acked at i + i*0.001 -> latency i ms
        for i in 1...100 { _ = f.ack(UInt64(i), at: Double(i) + Double(i) / 1000) }
        let p = f.latencyPercentiles()
        #expect(abs(p.p50 - 50) < 1.5)
        #expect(abs(p.p95 - 95) < 1.5)
    }

    @Test func latencyCumulativeAckCoversSkippedSeqs() {
        var f = FlowControl(maxUnacked: 1000)
        _ = f.nextSeq(sentAt: 0)
        _ = f.nextSeq(sentAt: 0.010)
        _ = f.ack(2, at: 0.030)   // covers seq1 (30ms) and seq2 (20ms)
        let p = f.latencyPercentiles()
        #expect(abs(p.p95 - 30) < 0.5)
    }

    @Test func latencyKeepsOnlyLast120() {
        var f = FlowControl(maxUnacked: 1000)
        // first 200 acks at 500 ms, next 120 at 10 ms
        for _ in 1...200 { _ = f.nextSeq(sentAt: 0) }
        _ = f.ack(200, at: 0.5)
        for _ in 1...120 { _ = f.nextSeq(sentAt: 1.0) }
        _ = f.ack(320, at: 1.010)
        let p = f.latencyPercentiles()
        #expect(abs(p.p95 - 10) < 0.5)
        #expect(abs(p.p50 - 10) < 0.5)
    }
}
