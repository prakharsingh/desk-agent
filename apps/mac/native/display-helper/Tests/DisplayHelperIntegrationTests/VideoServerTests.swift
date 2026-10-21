import DisplayHelperCore
import DisplayHelperSystem
import Foundation
import Testing

/// Real loopback sockets, no permissions needed: runs in every `swift test`.
private final class Box: @unchecked Sendable {
    private let lock = NSLock()
    private var _received = Data()
    private var _closed = 0
    private var _ready = false
    private var _failure: Error?
    private var _conn: (PhoneConnection & ByteSource)?
    func received(_ d: Data) { lock.lock(); _received.append(d); lock.unlock() }
    func closedOnce() { lock.lock(); _closed += 1; lock.unlock() }
    func ready() { lock.lock(); _ready = true; lock.unlock() }
    func failed(_ e: Error) { lock.lock(); _failure = e; lock.unlock() }
    func set(_ c: PhoneConnection & ByteSource) { lock.lock(); _conn = c; lock.unlock() }
    var bytes: Data { lock.lock(); defer { lock.unlock() }; return _received }
    var closeCount: Int { lock.lock(); defer { lock.unlock() }; return _closed }
    var isReady: Bool { lock.lock(); defer { lock.unlock() }; return _ready }
    var failure: Error? { lock.lock(); defer { lock.unlock() }; return _failure }
    var conn: (PhoneConnection & ByteSource)? { lock.lock(); defer { lock.unlock() }; return _conn }
}

private func wait(upTo seconds: Double, until cond: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
        if cond() { return true }
        Thread.sleep(forTimeInterval: 0.02)
    }
    return cond()
}

private func randomPort() -> UInt16 { UInt16.random(in: 40_000...59_000) }

private func makeServer(port: UInt16, queue: DispatchQueue, box: Box) throws -> VideoServer {
    try VideoServer(port: port, queue: queue,
                    onReady: { box.ready() },
                    onAccept: { conn in
                        conn.onReceive = { box.received($0) }
                        conn.onClose = { box.closedOnce() }
                        box.set(conn)
                    },
                    onFailed: { box.failed($0) })
}

/// Blocking POSIX client connected to 127.0.0.1:port, or -1.
private func connectClient(port: UInt16) -> Int32 {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = port.bigEndian
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    var tv = timeval(tv_sec: 3, tv_usec: 0)
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    let rc = withUnsafePointer(to: &addr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
    }
    if rc != 0 { close(fd); return -1 }
    return fd
}

private func readAll(_ fd: Int32, count: Int) -> Data {
    var out = Data()
    var buf = [UInt8](repeating: 0, count: 256)
    while out.count < count {
        let n = read(fd, &buf, buf.count)
        if n <= 0 { break }
        out.append(contentsOf: buf[0..<n])
    }
    return out
}

@Suite(.serialized) struct VideoServerTests {
    @Test func roundTripsBytesAndReportsARemoteClose() throws {
        let port = randomPort()
        let queue = DispatchQueue(label: "test.videoserver")
        let box = Box()
        let server = try makeServer(port: port, queue: queue, box: box)
        server.start()
        defer { server.stop() }
        #expect(wait(upTo: 3) { box.isReady })

        let fd = connectClient(port: port)
        try #require(fd >= 0)
        _ = "ping!".withCString { write(fd, $0, 5) }
        #expect(wait(upTo: 3) { box.bytes == Data("ping!".utf8) })

        queue.sync { box.conn?.send(Data("pong".utf8)) }
        #expect(readAll(fd, count: 4) == Data("pong".utf8))

        close(fd)
        #expect(wait(upTo: 3) { box.closeCount == 1 })
    }

    @Test func localCloseFlushesQueuedBytesThenSendsEOF() throws {
        let port = randomPort()
        let queue = DispatchQueue(label: "test.videoserver")
        let box = Box()
        let server = try makeServer(port: port, queue: queue, box: box)
        server.start()
        defer { server.stop() }
        #expect(wait(upTo: 3) { box.isReady })

        let fd = connectClient(port: port)
        try #require(fd >= 0)
        defer { close(fd) }
        #expect(wait(upTo: 3) { box.conn != nil })
        queue.sync {
            box.conn?.send(Data("end-frame".utf8))
            box.conn?.close()
        }
        // The queued bytes arrive before EOF (read returns 0 after them).
        #expect(readAll(fd, count: 64) == Data("end-frame".utf8))
        #expect(wait(upTo: 3) { box.closeCount == 1 })
    }

    @Test func aSecondListenerOnTheSamePortFailsWithAddressInUse() throws {
        let port = randomPort()
        let queue = DispatchQueue(label: "test.videoserver")
        let first = Box(), second = Box()
        let a = try makeServer(port: port, queue: queue, box: first)
        a.start()
        defer { a.stop() }
        #expect(wait(upTo: 3) { first.isReady })

        let b = try makeServer(port: port, queue: queue, box: second)
        b.start()
        defer { b.stop() }
        #expect(wait(upTo: 3) { second.failure != nil })
        #expect(!second.isReady)
        #expect(second.failure.map(VideoServer.isAddressInUse) == true)
    }

    @Test func rebindsWhileAnEarlierServerSideCloseIsInTimeWait() throws {
        let port = randomPort()
        let queue = DispatchQueue(label: "test.videoserver")
        let first = Box()
        let a = try makeServer(port: port, queue: queue, box: first)
        a.start()
        #expect(wait(upTo: 3) { first.isReady })
        let fd = connectClient(port: port)
        try #require(fd >= 0)
        #expect(wait(upTo: 3) { first.conn != nil })
        queue.sync { first.conn?.close() }        // server closes first → its side enters TIME_WAIT
        _ = readAll(fd, count: 1)
        close(fd)
        a.stop()
        Thread.sleep(forTimeInterval: 0.2)

        let second = Box()
        let b = try makeServer(port: port, queue: queue, box: second)
        b.start()
        defer { b.stop() }
        #expect(wait(upTo: 3) { second.isReady || second.failure != nil })
        #expect(second.isReady)
        #expect(second.failure == nil)
    }
}
