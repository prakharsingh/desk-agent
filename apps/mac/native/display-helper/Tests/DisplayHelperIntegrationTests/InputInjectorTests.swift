import CoreGraphics
import DisplayHelperCore
@testable import DisplayHelperSystem
import Foundation
import Testing

/// Builds CGEvents only — nothing is posted, no display is created.
@Suite struct InputInjectorTests {
    private func build(_ e: SyntheticEvent, cursor: CGPoint = CGPoint(x: 9, y: 9)) -> CGEvent? {
        InputInjector.cgEvent(for: e, source: nil, cursor: { cursor })
    }

    @Test func mouseEventsCarryTypeLocationAndClickState() throws {
        let down = try #require(build(.leftDown(CGPoint(x: 10, y: -20), clickState: 2)))
        #expect(down.type == .leftMouseDown)
        #expect(down.location == CGPoint(x: 10, y: -20))
        #expect(down.getIntegerValueField(.mouseEventClickState) == 2)

        let up = try #require(build(.leftUp(CGPoint(x: 10, y: -20), clickState: 0)))
        #expect(up.type == .leftMouseUp)
        #expect(up.getIntegerValueField(.mouseEventClickState) == 0)

        #expect(build(.move(CGPoint(x: 1, y: 2)))?.type == .mouseMoved)
        #expect(build(.leftDragged(CGPoint(x: 1, y: 2)))?.type == .leftMouseDragged)
        let right = try #require(build(.rightDown(CGPoint(x: 3, y: 4))))
        #expect(right.type == .rightMouseDown)
        #expect(right.getIntegerValueField(.mouseEventButtonNumber) == Int64(CGMouseButton.right.rawValue))
        #expect(build(.rightUp(CGPoint(x: 3, y: 4)))?.type == .rightMouseUp)
    }

    @Test func scrollIsPixelUnitsWithWheel1DyAndWheel2DxAtTheCursor() throws {
        let e = try #require(build(.scroll(dxPoints: 7, dyPoints: -30), cursor: CGPoint(x: 100, y: -200)))
        #expect(e.type == .scrollWheel)
        #expect(e.getIntegerValueField(.scrollWheelEventIsContinuous) == 1)   // .pixel units
        #expect(e.getIntegerValueField(.scrollWheelEventPointDeltaAxis1) == -30)
        #expect(e.getIntegerValueField(.scrollWheelEventPointDeltaAxis2) == 7)
        #expect(e.location == CGPoint(x: 100, y: -200))
    }

    /// I1: a scroll after the planner's `.move` lands at that point, not at the (stale) real pointer.
    @Test func scrollInABatchLandsWhereTheBatchMovedThePointer() {
        let to = CGPoint(x: 1700, y: 300)
        var reads = 0
        let events = InputInjector.cgEvents(for: [.move(to), .scroll(dxPoints: 0, dyPoints: 5)], source: nil,
                                            cursor: { reads += 1; return CGPoint(x: -500, y: -500) })
        #expect(events.map(\.type) == [.mouseMoved, .scrollWheel])
        #expect(events.last?.location == to)
        #expect(reads == 0)
        // Without a move in the batch, the real pointer is used.
        let alone = InputInjector.cgEvents(for: [.scroll(dxPoints: 0, dyPoints: 5)], source: nil,
                                           cursor: { CGPoint(x: -500, y: -500) })
        #expect(alone.first?.location == CGPoint(x: -500, y: -500))
    }

    @Test func buildsOneEventPerSyntheticEventInOrder() {
        let events = InputInjector.cgEvents(
            for: [.move(.zero), .leftDown(.zero, clickState: 1), .leftUp(.zero, clickState: 1)],
            source: nil, cursor: { .zero })
        #expect(events.map(\.type) == [.mouseMoved, .leftMouseDown, .leftMouseUp])
    }
}

@Suite struct ReconfigurationObserverTests {
    private final class Counter: @unchecked Sendable {
        private let lock = NSLock()
        private var n = 0
        func bump() { lock.lock(); n += 1; lock.unlock() }
        var value: Int { lock.lock(); defer { lock.unlock() }; return n }
    }

    @Test func ignoresOtherDisplaysAndTheBeginPhase() {
        #expect(ReconfigurationObserver.isRelevant(display: 7, flags: .movedFlag, ours: 7))
        #expect(ReconfigurationObserver.isRelevant(display: 7, flags: .setModeFlag, ours: 7))
        #expect(!ReconfigurationObserver.isRelevant(display: 8, flags: .movedFlag, ours: 7))
        #expect(!ReconfigurationObserver.isRelevant(display: 7, flags: .beginConfigurationFlag, ours: 7))
    }

    /// Polls `condition` until it holds or `timeout` passes (generous: CI machines can be slow).
    private func waitUntil(timeout: TimeInterval = 5, _ condition: () -> Bool) async throws -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline { return false }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        return true
    }

    @Test func aBurstFromAnyThreadIsCoalescedOntoTheQueue() async throws {
        let queue = DispatchQueue(label: "session")
        let key = DispatchSpecificKey<Bool>()
        queue.setSpecific(key: key, value: true)
        let calls = Counter(), onQueue = Counter()
        let observer = ReconfigurationObserver(displayId: 7, queue: queue, window: 0.05) {
            calls.bump()
            if DispatchQueue.getSpecific(key: key) == true { onQueue.bump() }
        }
        DispatchQueue.concurrentPerform(iterations: 8) { _ in
            observer.notify(display: 7, flags: [.movedFlag, .setModeFlag])
        }
        observer.notify(display: 8, flags: .movedFlag)
        #expect(try await waitUntil { calls.value >= 1 })
        // Nothing else was scheduled: a queue barrier after a few more windows still sees one call.
        try await Task.sleep(nanoseconds: 200_000_000)
        queue.sync {}
        #expect(calls.value == 1)
        #expect(onQueue.value == 1)
        // A later change is delivered again.
        observer.notify(display: 7, flags: .movedFlag)
        #expect(try await waitUntil { calls.value == 2 })
    }

    @Test func nothingIsDeliveredAfterCancel() async throws {
        let queue = DispatchQueue(label: "session")
        let calls = Counter(), firsts = Counter()
        let observer = ReconfigurationObserver(displayId: 7, queue: queue, window: 0.05,
                                               onFirstCallback: { _ in firsts.bump() }) { calls.bump() }
        queue.sync { observer.cancel() }
        observer.notify(display: 7, flags: .movedFlag)
        // A sentinel scheduled after the observer's window: once it ran, the window has passed.
        let sentinel = Counter()
        queue.asyncAfter(deadline: .now() + 0.15) { sentinel.bump() }
        #expect(try await waitUntil { sentinel.value == 1 })
        #expect(calls.value == 0)
        #expect(firsts.value == 0)
    }

    @Test func scheduledDeliveryIsDroppedByCancel() async throws {
        let queue = DispatchQueue(label: "session")
        let calls = Counter()
        let observer = ReconfigurationObserver(displayId: 7, queue: queue, window: 0.05) { calls.bump() }
        observer.notify(display: 7, flags: .movedFlag)   // scheduled, then cancelled before it runs
        queue.sync { observer.cancel() }
        let sentinel = Counter()
        queue.asyncAfter(deadline: .now() + 0.15) { sentinel.bump() }
        #expect(try await waitUntil { sentinel.value == 1 })
        #expect(calls.value == 0)
    }

    @Test func reportsTheFirstCallbacksThreadOnceOnTheQueue() async throws {
        let queue = DispatchQueue(label: "session")
        let key = DispatchSpecificKey<Bool>()
        queue.setSpecific(key: key, value: true)
        let reports = Counter(), mainReports = Counter(), onQueue = Counter()
        let observer = ReconfigurationObserver(displayId: 7, queue: queue, window: 0.05, onFirstCallback: { onMain in
            reports.bump()
            if onMain { mainReports.bump() }
            if DispatchQueue.getSpecific(key: key) == true { onQueue.bump() }
        }) {}
        // Even an irrelevant first callback (another display) reports the thread.
        DispatchQueue.global().sync { observer.notify(display: 8, flags: .movedFlag) }
        observer.notify(display: 7, flags: .movedFlag)
        #expect(try await waitUntil { reports.value == 1 })
        queue.sync {}
        #expect(reports.value == 1)
        #expect(mainReports.value == 0)   // first call came from a background thread
        #expect(onQueue.value == 1)
    }
}
