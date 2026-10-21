import Testing
@testable import DisplayHelperCore

@Suite struct SessionTimersTests {
    @Test func watchdogExpiresAfter2sActive() {
        var w = KeepaliveWatchdog(now: 0)
        w.heard(at: 1.0)
        #expect(!w.isExpired(at: 2.9))
        #expect(w.isExpired(at: 3.01))
    }

    @Test func watchdogUsesGraceWhilePaused() {
        var w = KeepaliveWatchdog(now: 0)
        w.setPaused(true, at: 0)
        #expect(!w.isExpired(at: 9.9))
        #expect(w.isExpired(at: 10.01))
    }

    @Test func watchdogResumeRestoresActiveTimeout() {
        var w = KeepaliveWatchdog(now: 0)
        w.setPaused(true, at: 0)
        w.setPaused(false, at: 5)
        #expect(!w.isExpired(at: 6.9))
        #expect(w.isExpired(at: 7.01))
    }

    @Test func heardResetsTimer() {
        var w = KeepaliveWatchdog(now: 0)
        #expect(w.isExpired(at: 2.01))
        w.heard(at: 2.0)
        #expect(!w.isExpired(at: 3.9))
    }

    @Test func connectDeadlineAt10s() {
        let d = ConnectDeadline(createdAt: 5)
        #expect(!d.isExpired(at: 14.9))
        #expect(d.isExpired(at: 15.01))
    }
}
