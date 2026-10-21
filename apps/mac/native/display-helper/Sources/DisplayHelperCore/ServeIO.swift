import Foundation

/// The read side of one accepted video-socket connection (F16). `VideoServer` hands out objects that are
/// both `PhoneConnection` (write/close) and `ByteSource` (read events); `main.swift` routes both
/// callbacks into `SessionController.receive(_:on:)` / `closed(_:)`.
///
/// Callbacks are delivered on the session queue that `VideoServer` was created with. `onClose` fires
/// at most once, for a remote close, a socket error, or a local `close()`.
public protocol ByteSource: AnyObject {
    var onReceive: ((Data) -> Void)? { get set }
    var onClose: (() -> Void)? { get set }
}

/// Splits a byte stream into `\n`-terminated lines (a trailing `\r` is dropped). Bytes are buffered
/// until a newline, so multi-byte UTF-8 characters split across reads decode correctly. A line longer
/// than `maxLineBytes` is discarded up to its newline.
public struct LineSplitter: Sendable {
    public let maxLineBytes: Int
    private var buffer = Data()
    private var discarding = false

    public init(maxLineBytes: Int = 1 << 20) { self.maxLineBytes = maxLineBytes }

    public mutating func append(_ data: Data) -> [String] {
        var lines: [String] = []
        for byte in data {
            if byte == 0x0A {
                if !discarding { lines.append(Self.decode(buffer)) }
                buffer.removeAll(keepingCapacity: true)
                discarding = false
            } else if !discarding {
                buffer.append(byte)
                if buffer.count > maxLineBytes {
                    buffer.removeAll()
                    discarding = true
                }
            }
        }
        return lines
    }

    /// At EOF: the unterminated tail, if any (once).
    public mutating func finish() -> String? {
        defer { buffer.removeAll(); discarding = false }
        guard !discarding, !buffer.isEmpty else { return nil }
        return Self.decode(buffer)
    }

    private static func decode(_ bytes: Data) -> String {
        var b = bytes
        if b.last == 0x0D { b.removeLast() }
        return String(decoding: b, as: UTF8.self)
    }
}

/// `serve` stdin protocol (Contract C): the first non-blank line must be `start`; afterwards `stop`
/// requests a stop and EOF means the parent died.
public struct ServeInput: Sendable {
    public enum Action: Equatable, Sendable {
        case start(StartCommand)
        case stop(EndReason)
        /// Nothing to do; a non-nil message is worth a `log` warning.
        case ignore(String?)
        /// Exit 2.
        case usageError(String)
    }

    public private(set) var started = false
    private var failed = false

    public init() {}

    public mutating func line(_ raw: String) -> Action {
        let text = raw.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return .ignore(nil) }
        guard !failed else { return .ignore(nil) }
        let command = try? HelperCommand.decodeLine(text)
        guard started else {
            guard case .start(let start)? = command else {
                failed = true
                return .usageError("the first stdin line must be a valid start command")
            }
            started = true
            return .start(start)
        }
        switch command {
        case .stop?: return .stop(.stopRequested)
        case .start?: return .ignore("duplicate start command ignored")
        case nil: return .ignore("invalid stdin command ignored")
        }
    }

    public mutating func eof() -> Action {
        guard started else { return .usageError("stdin closed before a start command") }
        return .stop(.parentExit)
    }
}

/// Parent-death detection by polling `getppid()`: any change from the parent we started with means
/// the parent died and we were re-parented (normally to launchd, pid 1).
public enum ParentWatch {
    public static func isOrphaned(originalParent: Int32, currentParent: Int32) -> Bool {
        currentParent != originalParent
    }
}

/// Contract C `--check` / `--request-permissions` output.
public struct PermissionsReport: Encodable, Equatable, Sendable {
    public var screenRecording: Bool
    public var postEvent: Bool
    public var macos: String

    public init(screenRecording: Bool, postEvent: Bool, macos: String) {
        self.screenRecording = screenRecording
        self.postEvent = postEvent
        self.macos = macos
    }

    public static func versionString(major: Int, minor: Int, patch: Int) -> String {
        "\(major).\(minor).\(patch)"
    }

    /// One JSON object, sorted keys, no trailing newline.
    public func jsonLine() -> String {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? e.encode(self), let s = String(data: data, encoding: .utf8) else {
            return #"{"macos":"","postEvent":false,"screenRecording":false}"#
        }
        return s
    }
}
