import DisplayHelperCore
import Foundation
import Network

/// Loopback TCP listener for the phone's video socket (Contract D; the phone reaches it through
/// `adb reverse`). Binds 127.0.0.1 only, TCP_NODELAY.
///
/// Threading: the listener and every accepted connection run on `queue`, which must be the serial
/// session queue, so `onReady` / `onAccept` / `onFailed` and the connections' `onReceive` / `onClose`
/// arrive already serialized with every other `SessionController` call.
public final class VideoServer {
    private let queue: DispatchQueue
    private let listener: NWListener
    private var reported = false

    /// `onReady`: the port is bound and listening (only now may the session create its display).
    /// `onAccept`: a new connection; reading starts after this returns, so callers set its callbacks inside.
    /// `onFailed`: bind/listen failed (e.g. `EADDRINUSE`) or the listener died later; reported once.
    public init(port: UInt16, queue: DispatchQueue,
                onReady: @escaping () -> Void,
                onAccept: @escaping (PhoneConnection & ByteSource) -> Void,
                onFailed: @escaping (Error) -> Void) throws {
        self.queue = queue
        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        let params = NWParameters(tls: nil, tcp: tcp)
        guard let nwPort = NWEndpoint.Port(rawValue: port), port != 0 else {
            throw NWError.posix(.EINVAL)
        }
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: nwPort)
        // A previous session's TIME_WAIT sockets on this port must not block the next helper's bind,
        // while a live listener on the port must still fail with EADDRINUSE (both covered by
        // VideoServerTests). NWListener on macOS already rebinds over TIME_WAIT without this flag
        // (verified by mutation); it is set explicitly so that intent doesn't rest on a default.
        params.allowLocalEndpointReuse = true
        listener = try NWListener(using: params)

        listener.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                onReady()
            case .failed(let error), .waiting(let error):
                // `.waiting` on a listener means it could not bind; don't let it retry silently.
                self.fail(error, onFailed)
            default:
                break
            }
        }
        listener.newConnectionHandler = { nw in
            let conn = VideoConnection(nw, queue: queue)
            onAccept(conn)
            conn.startReceiving()
        }
    }

    public func start() { listener.start(queue: queue) }

    /// Stops accepting new connections (established ones are closed by their owner).
    public func stop() {
        reported = true
        listener.cancel()
    }

    private func fail(_ error: Error, _ onFailed: (Error) -> Void) {
        guard !reported else { return }
        reported = true
        listener.cancel()
        onFailed(error)
    }

    /// True for the bind failure that maps to `ended port-in-use`.
    public static func isAddressInUse(_ error: Error) -> Bool {
        if case .posix(let code)? = error as? NWError { return code == .EADDRINUSE }
        return false
    }
}

/// One accepted TCP connection: `PhoneConnection` (send/close) + `ByteSource` (receive/close events).
/// All callbacks run on the session queue. `onClose` is always delivered asynchronously, so a
/// `close()` issued from inside `SessionController` never re-enters it.
final class VideoConnection: PhoneConnection, ByteSource {
    var onReceive: ((Data) -> Void)?
    var onClose: (() -> Void)?

    private let connection: NWConnection
    private let queue: DispatchQueue
    private var closed = false

    init(_ connection: NWConnection, queue: DispatchQueue) {
        self.connection = connection
        self.queue = queue
        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled: self?.finish()
            default: break
            }
        }
        connection.start(queue: queue)
    }

    deinit {
        if !closed { connection.cancel() }
    }

    func startReceiving() {
        guard !closed else { return }
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self, !self.closed else { return }
            if let data, !data.isEmpty { self.onReceive?(data) }
            if isComplete || error != nil {
                self.close()
            } else if !self.closed {
                self.startReceiving()
            }
        }
    }

    func send(_ data: Data) {
        guard !closed else { return }
        connection.send(content: data, completion: .contentProcessed { _ in })
    }

    /// Graceful: already-queued sends (e.g. the `end` frame) go out before the FIN, then the
    /// connection is cancelled. `onClose` fires once.
    func close() {
        guard !closed else { return }
        let c = connection
        c.send(content: nil, contentContext: .finalMessage, isComplete: true,
               completion: .contentProcessed { _ in c.cancel() })
        finish()
    }

    private func finish() {
        guard !closed else { return }
        closed = true
        let callback = onClose
        onClose = nil
        onReceive = nil
        if let callback { queue.async(execute: callback) }
    }
}
