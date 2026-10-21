import Foundation

public struct StartCommand: Decodable, Equatable, Sendable {
    public var sessionId: String
    public var token: String
    public var port: UInt16
    public var surfaceW: Int
    public var surfaceH: Int
    public var orientation: Orientation
    public var serialNum: UInt32
    public var vendorId: UInt32
    public var productId: UInt32
    public var dpi: Double?

    public init(sessionId: String, token: String, port: UInt16, surfaceW: Int, surfaceH: Int,
                orientation: Orientation, serialNum: UInt32, vendorId: UInt32, productId: UInt32, dpi: Double?) {
        self.sessionId = sessionId; self.token = token; self.port = port
        self.surfaceW = surfaceW; self.surfaceH = surfaceH; self.orientation = orientation
        self.serialNum = serialNum; self.vendorId = vendorId; self.productId = productId; self.dpi = dpi
    }
}

public enum HelperCommandError: Error, Equatable {
    case invalid
}

public enum HelperCommand: Equatable, Sendable {
    case start(StartCommand)
    case stop

    public static func decodeLine(_ line: String) throws -> HelperCommand {
        let data = Data(line.utf8)
        guard let obj = try? JSONSerialization.jsonObject(with: data),
              let dict = obj as? [String: Any],
              let cmd = dict["cmd"] as? String else { throw HelperCommandError.invalid }
        switch cmd {
        case "start":
            do { return .start(try JSONDecoder().decode(StartCommand.self, from: data)) }
            catch { throw HelperCommandError.invalid }
        case "stop":
            return .stop
        default:
            throw HelperCommandError.invalid
        }
    }
}

public enum EndReason: String, Encodable, Equatable, Sendable {
    case stopRequested = "stop-requested"
    case phoneBye = "phone-bye"
    case watchdog
    case connectTimeout = "connect-timeout"
    case parentExit = "parent-exit"
    case unsupported
    case permissionScreenRecording = "permission-screen-recording"
    case captureFailed = "capture-failed"
    case portInUse = "port-in-use"
    case signal
    case captureUnavailable = "capture-unavailable"
    case protocolError = "protocol-error"
    case versionMismatch = "version-mismatch"
}

public struct StatsEvent: Encodable, Equatable, Sendable {
    public var fps: Int
    public var kbps: Int
    public var unacked: Int
    public var ackP50Ms: Double
    public var ackP95Ms: Double
    public var phoneRendered: UInt64
    public var phoneDropped: UInt64

    public init(fps: Int, kbps: Int, unacked: Int, ackP50Ms: Double, ackP95Ms: Double,
                phoneRendered: UInt64, phoneDropped: UInt64) {
        self.fps = fps; self.kbps = kbps; self.unacked = unacked
        self.ackP50Ms = ackP50Ms; self.ackP95Ms = ackP95Ms
        self.phoneRendered = phoneRendered; self.phoneDropped = phoneDropped
    }
}

public enum HelperEvent: Encodable, Equatable, Sendable {
    case ready(displayId: UInt32, port: UInt16)
    case connected
    case paused
    case resumed
    case stats(StatsEvent)
    case log(level: String, message: String)
    case ended(EndReason)

    enum CodingKeys: String, CodingKey {
        case evt, displayId, port, level, message, reason
        case fps, kbps, unacked, ackP50Ms, ackP95Ms, phoneRendered, phoneDropped
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .ready(let id, let port):
            try c.encode("ready", forKey: .evt)
            try c.encode(id, forKey: .displayId)
            try c.encode(port, forKey: .port)
        case .connected: try c.encode("connected", forKey: .evt)
        case .paused: try c.encode("paused", forKey: .evt)
        case .resumed: try c.encode("resumed", forKey: .evt)
        case .stats(let s):
            try c.encode("stats", forKey: .evt)
            try c.encode(s.fps, forKey: .fps)
            try c.encode(s.kbps, forKey: .kbps)
            try c.encode(s.unacked, forKey: .unacked)
            try c.encode(s.ackP50Ms, forKey: .ackP50Ms)
            try c.encode(s.ackP95Ms, forKey: .ackP95Ms)
            try c.encode(s.phoneRendered, forKey: .phoneRendered)
            try c.encode(s.phoneDropped, forKey: .phoneDropped)
        case .log(let level, let message):
            try c.encode("log", forKey: .evt)
            try c.encode(level, forKey: .level)
            try c.encode(message, forKey: .message)
        case .ended(let reason):
            try c.encode("ended", forKey: .evt)
            try c.encode(reason, forKey: .reason)
        }
    }

    /// One JSON object, sorted keys, no trailing newline.
    public func jsonLine() -> String {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? e.encode(self), let s = String(data: data, encoding: .utf8) else {
            return #"{"evt":"log","level":"error","message":"event encoding failed"}"#
        }
        return s
    }
}
