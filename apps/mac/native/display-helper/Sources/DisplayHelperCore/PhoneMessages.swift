import Foundation

public enum Orientation: String, Codable, Equatable, Sendable {
    case portrait, landscape
}

public struct Hello: Equatable, Decodable, Sendable {
    public var v: Int
    public var token: String
    public var sessionId: String
    public var surfaceW: Int
    public var surfaceH: Int
    public var orientation: Orientation
    public var codecs: [String]
    public var maxW: Int
    public var maxH: Int
    public var trackpad: Bool

    public init(v: Int, token: String, sessionId: String, surfaceW: Int, surfaceH: Int,
                orientation: Orientation, codecs: [String], maxW: Int, maxH: Int, trackpad: Bool) {
        self.v = v; self.token = token; self.sessionId = sessionId
        self.surfaceW = surfaceW; self.surfaceH = surfaceH; self.orientation = orientation
        self.codecs = codecs; self.maxW = maxW; self.maxH = maxH; self.trackpad = trackpad
    }
}

public struct PhoneStats: Equatable, Decodable, Sendable {
    public var rendered: UInt64
    public var dropped: UInt64
    public var decodeMsAvg: Double
    public init(rendered: UInt64, dropped: UInt64, decodeMsAvg: Double) {
        self.rendered = rendered; self.dropped = dropped; self.decodeMsAvg = decodeMsAvg
    }
}

public enum InputKind: String, Equatable, Sendable {
    case click, rightClick, dragStart, dragMove, dragEnd, scroll, move
    /// An `e` value this helper does not know; ignored by consumers, not an error.
    case unknown
}

public struct InputEvent: Equatable, Decodable, Sendable {
    public var kind: InputKind
    public var x: Double?
    public var y: Double?
    public var dx: Double?
    public var dy: Double?

    enum CodingKeys: String, CodingKey {
        case kind = "e"
        case x, y, dx, dy
    }

    public init(kind: InputKind, x: Double? = nil, y: Double? = nil, dx: Double? = nil, dy: Double? = nil) {
        self.kind = kind; self.x = x; self.y = y; self.dx = dx; self.dy = dy
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try c.decode(String.self, forKey: .kind)
        kind = InputKind(rawValue: raw).flatMap { $0 == .unknown ? nil : $0 } ?? .unknown
        x = try c.decodeIfPresent(Double.self, forKey: .x)
        y = try c.decodeIfPresent(Double.self, forKey: .y)
        dx = try c.decodeIfPresent(Double.self, forKey: .dx)
        dy = try c.decodeIfPresent(Double.self, forKey: .dy)
    }
}

public enum PhoneMessageError: Error, Equatable {
    case invalid
}

public enum PhoneMessage: Equatable, Sendable {
    case hello(Hello)
    case keepalive
    case ack(seq: UInt64)
    case requestIdr
    case resize(w: Int, h: Int, orientation: Orientation)
    case pause
    case resume
    case setTrackpad(Bool)
    case input(InputEvent)
    case stats(PhoneStats)
    case bye(reason: String)
    case unknown(String)

    private struct Ack: Decodable { let seq: UInt64 }
    private struct Resize: Decodable { let surfaceW: Int; let surfaceH: Int; let orientation: Orientation }
    private struct Trackpad: Decodable { let enabled: Bool }
    private struct Bye: Decodable { let reason: String }

    /// Only invalid JSON, a non-object, or a missing/non-string `t` are errors, plus a known `t`
    /// whose required fields are missing/invalid. Unknown `t` -> `.unknown`; unknown fields ignored.
    public static func decode(_ json: Data) throws -> PhoneMessage {
        guard let obj = try? JSONSerialization.jsonObject(with: json),
              let dict = obj as? [String: Any],
              let t = dict["t"] as? String else { throw PhoneMessageError.invalid }
        let d = JSONDecoder()
        do {
            switch t {
            case "hello": return .hello(try d.decode(Hello.self, from: json))
            case "keepalive": return .keepalive
            case "ack": return .ack(seq: try d.decode(Ack.self, from: json).seq)
            case "requestIdr": return .requestIdr
            case "resize":
                let r = try d.decode(Resize.self, from: json)
                return .resize(w: r.surfaceW, h: r.surfaceH, orientation: r.orientation)
            case "pause": return .pause
            case "resume": return .resume
            case "setTrackpad": return .setTrackpad(try d.decode(Trackpad.self, from: json).enabled)
            case "input": return .input(try d.decode(InputEvent.self, from: json))
            case "stats": return .stats(try d.decode(PhoneStats.self, from: json))
            case "bye": return .bye(reason: try d.decode(Bye.self, from: json).reason)
            default: return .unknown(t)
            }
        } catch {
            throw PhoneMessageError.invalid
        }
    }
}

public enum HelperMessage: Encodable, Equatable, Sendable {
    case helloAck(inputEnabled: Bool)
    /// Additive (an older phone ignores the unknown `t`): Accessibility (PostEvent) was granted or revoked
    /// mid-session, so touch input is now on or off. Same flag semantics as `helloAck.inputEnabled`.
    case inputState(inputEnabled: Bool)
    case streamConfig(w: Int, h: Int)
    case keepalive
    case end(reason: String)

    enum CodingKeys: String, CodingKey { case t, inputEnabled, w, h, reason }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .helloAck(let enabled):
            try c.encode("helloAck", forKey: .t)
            try c.encode(enabled, forKey: .inputEnabled)
        case .inputState(let enabled):
            try c.encode("inputState", forKey: .t)
            try c.encode(enabled, forKey: .inputEnabled)
        case .streamConfig(let w, let h):
            try c.encode("streamConfig", forKey: .t)
            try c.encode(w, forKey: .w)
            try c.encode(h, forKey: .h)
        case .keepalive:
            try c.encode("keepalive", forKey: .t)
        case .end(let reason):
            try c.encode("end", forKey: .t)
            try c.encode(reason, forKey: .reason)
        }
    }
}
