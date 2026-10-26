import Foundation

public enum AnnexBError: Error, Equatable {
    /// A length prefix or NAL unit runs past the end of the buffer.
    case truncated
    /// AVCC length fields are 1, 2 or 4 bytes.
    case badLengthSize(Int)
}

/// AVCC (length-prefixed, as VideoToolbox emits) → Annex-B (start-code-prefixed, as MediaCodec wants).
public enum AnnexB {
    public static let startCode: [UInt8] = [0, 0, 0, 1]

    public static func fromAVCC(_ data: Data, nalLengthSize: Int = 4) throws -> Data {
        guard [1, 2, 4].contains(nalLengthSize) else { throw AnnexBError.badLengthSize(nalLengthSize) }
        var out = Data(capacity: data.count + 16)
        var i = data.startIndex
        while i < data.endIndex {
            guard data.endIndex - i >= nalLengthSize else { throw AnnexBError.truncated }
            var len = 0
            for k in 0..<nalLengthSize { len = (len << 8) | Int(data[i + k]) }
            i += nalLengthSize
            guard data.endIndex - i >= len else { throw AnnexBError.truncated }
            out.append(contentsOf: startCode)
            out.append(data[i..<(i + len)])
            i += len
        }
        return out
    }

    /// SPS then PPS, each prefixed with `00 00 00 01`.
    public static func parameterSets(sps: [Data], pps: [Data]) -> Data {
        var out = Data()
        for nal in sps + pps {
            out.append(contentsOf: startCode)
            out.append(nal)
        }
        return out
    }
}
