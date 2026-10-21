import Foundation
import Testing
@testable import DisplayHelperCore

@Suite struct FramingTests {
    @Test func videoFrameRoundTrips() throws {
        var d = FrameDecoder(maxLength: Framing.maxFrameLength)
        let bytes = Framing.video(flags: [.keyframe], seq: 7, payload: Data([0, 0, 0, 1, 0x65]))
        #expect(bytes.prefix(5) == Data([0, 0, 0, 15, 0x01]))
        #expect(try d.append(bytes) == [.video([.keyframe], seq: 7, payload: Data([0, 0, 0, 1, 0x65]))])
    }

    @Test func videoFlagsEncodeBits() {
        let b = Framing.video(flags: [.keyframe, .config], seq: 0x0102030405060708, payload: Data())
        #expect(Array(b) == [0, 0, 0, 10, 0x01, 0x03, 1, 2, 3, 4, 5, 6, 7, 8])
    }

    @Test func jsonFrameRoundTrips() throws {
        struct M: Encodable { let t = "keepalive" }
        let bytes = try Framing.json(M())
        var d = FrameDecoder(maxLength: Framing.maxFrameLength)
        let body = Data(#"{"t":"keepalive"}"#.utf8)
        #expect(bytes.prefix(5) == Data([0, 0, 0, UInt8(body.count + 1), 0x02]))
        #expect(try d.append(bytes) == [.json(body)])
    }

    @Test func decoderHandlesSplitAndCoalescedReads() throws {
        let a = Framing.video(flags: [.config], seq: 0, payload: Data([1, 2, 3]))
        let b = Framing.video(flags: [], seq: 2, payload: Data([9, 9]))
        let all = a + b
        var d = FrameDecoder(maxLength: Framing.maxFrameLength)
        var out: [DecodedFrame] = []
        out += try d.append(all.subdata(in: 0..<3))
        #expect(out.isEmpty)
        out += try d.append(all.subdata(in: 3..<(a.count + 4)))
        out += try d.append(all.subdata(in: (a.count + 4)..<all.count))
        #expect(out == [.video([.config], seq: 0, payload: Data([1, 2, 3])),
                        .video([], seq: 2, payload: Data([9, 9]))])
    }

    @Test func rejectsOversizeBeforeAuth() {
        var d = FrameDecoder(maxLength: Framing.maxPreAuthLength)
        #expect(throws: FramingError.tooLarge(4097)) { try d.append(Data([0, 0, 0x10, 0x01, 0x02])) }
    }

    @Test func setMaxLengthRaisesCapAfterAuth() throws {
        var d = FrameDecoder(maxLength: Framing.maxPreAuthLength)
        d.setMaxLength(Framing.maxPhoneFrameLength)
        // 5000-byte JSON frame header only: accepted (waits for payload)
        #expect(try d.append(Data([0, 0, 0x13, 0x89, 0x02])).isEmpty)
    }

    @Test func rejectsZeroLength() {
        var d = FrameDecoder(maxLength: 100)
        #expect(throws: FramingError.zeroLength) { try d.append(Data([0, 0, 0, 0, 0x02])) }
    }

    @Test func rejectsUnknownKind() {
        var d = FrameDecoder(maxLength: 100)
        #expect(throws: FramingError.unknownKind(9)) { try d.append(Data([0, 0, 0, 1, 0x09])) }
    }

    @Test func truncatedVideoHeaderIsAFramingError() {
        var d = FrameDecoder(maxLength: 100)
        #expect(throws: FramingError.truncatedVideoHeader) { try d.append(Data([0, 0, 0, 5, 0x01])) }
    }

    @Test func validatesAtHeaderBeforePayloadArrives() {
        // F6: only the 5 header bytes are present; error must already be raised.
        var d = FrameDecoder(maxLength: 100)
        #expect(throws: FramingError.tooLarge(0x01000000)) { try d.append(Data([1, 0, 0, 0, 0x02])) }
    }
}
