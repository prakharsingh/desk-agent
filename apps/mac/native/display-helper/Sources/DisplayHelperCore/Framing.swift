import Foundation

/// Contract D framing: `len:u32be kind:u8 body[len-1]`.
public enum Framing {
    public static let maxFrameLength: UInt32 = 8_388_608
    public static let maxPreAuthLength: UInt32 = 4096
    public static let maxPhoneFrameLength: UInt32 = 65_536

    static let kindVideo: UInt8 = 0x01
    static let kindJSON: UInt8 = 0x02

    public static func video(flags: VideoFlags, seq: UInt64, payload: Data) -> Data {
        var out = Data(capacity: 14 + payload.count)
        appendU32(&out, UInt32(10 + payload.count))
        out.append(kindVideo)
        out.append(flags.rawValue)
        for shift in stride(from: 56, through: 0, by: -8) {
            out.append(UInt8(truncatingIfNeeded: seq >> UInt64(shift)))
        }
        out.append(payload)
        return out
    }

    public static func json<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let body = try encoder.encode(value)
        var out = Data(capacity: 5 + body.count)
        appendU32(&out, UInt32(1 + body.count))
        out.append(kindJSON)
        out.append(body)
        return out
    }

    static func appendU32(_ d: inout Data, _ v: UInt32) {
        d.append(UInt8(truncatingIfNeeded: v >> 24))
        d.append(UInt8(truncatingIfNeeded: v >> 16))
        d.append(UInt8(truncatingIfNeeded: v >> 8))
        d.append(UInt8(truncatingIfNeeded: v))
    }
}

public struct VideoFlags: OptionSet, Sendable {
    public let rawValue: UInt8
    public init(rawValue: UInt8) { self.rawValue = rawValue }
    public static let keyframe = VideoFlags(rawValue: 1)
    public static let config = VideoFlags(rawValue: 2)
}

public enum DecodedFrame: Equatable, Sendable {
    case video(VideoFlags, seq: UInt64, payload: Data)
    case json(Data)
}

public enum FramingError: Error, Equatable {
    case zeroLength
    case tooLarge(UInt32)
    case unknownKind(UInt8)
    /// VIDEO frame with len < 10.
    case truncatedVideoHeader
}

/// Incremental frame decoder. Validates as soon as the 5-byte header is available
/// (zero length is detected from the first 4 bytes), before the payload arrives.
public struct FrameDecoder {
    private var maxLength: UInt32
    private var buffer = Data()

    public init(maxLength: UInt32) { self.maxLength = maxLength }

    public mutating func setMaxLength(_ n: UInt32) { maxLength = n }

    public mutating func append(_ bytes: Data) throws -> [DecodedFrame] {
        buffer.append(bytes)
        var frames: [DecodedFrame] = []
        while true {
            guard buffer.count >= 4 else { break }
            let b = Array(buffer.prefix(5))
            let len = UInt32(b[0]) << 24 | UInt32(b[1]) << 16 | UInt32(b[2]) << 8 | UInt32(b[3])
            if len == 0 { throw FramingError.zeroLength }
            if len > maxLength { throw FramingError.tooLarge(len) }
            guard b.count == 5 else { break }
            let kind = b[4]
            switch kind {
            case Framing.kindVideo:
                if len < 10 { throw FramingError.truncatedVideoHeader }
            case Framing.kindJSON:
                break
            default:
                throw FramingError.unknownKind(kind)
            }
            let total = 4 + Int(len)
            guard buffer.count >= total else { break }
            let body = Array(buffer[buffer.startIndex + 5 ..< buffer.startIndex + total])
            buffer = Data(buffer.dropFirst(total))
            if kind == Framing.kindVideo {
                var seq: UInt64 = 0
                for i in 1..<9 { seq = seq << 8 | UInt64(body[i]) }
                frames.append(.video(VideoFlags(rawValue: body[0]), seq: seq, payload: Data(body[9...])))
            } else {
                frames.append(.json(Data(body)))
            }
        }
        return frames
    }
}
