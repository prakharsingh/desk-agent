import Foundation
import Testing
@testable import DisplayHelperCore

@Suite struct PhoneMessagesTests {
    func dec(_ s: String) throws -> PhoneMessage { try PhoneMessage.decode(Data(s.utf8)) }

    @Test func decodesHello() throws {
        let m = try dec(#"{"t":"hello","v":1,"token":"ab","sessionId":"s1","surfaceW":2340,"surfaceH":1080,"orientation":"landscape","codecs":["h264"],"maxW":4096,"maxH":2304,"trackpad":false}"#)
        #expect(m == .hello(Hello(v: 1, token: "ab", sessionId: "s1", surfaceW: 2340, surfaceH: 1080,
                                  orientation: .landscape, codecs: ["h264"], maxW: 4096, maxH: 2304, trackpad: false)))
    }

    @Test func helloMissingFieldThrows() {
        #expect(throws: PhoneMessageError.invalid) { try dec(#"{"t":"hello","v":1}"#) }
    }

    @Test func simpleMessages() throws {
        #expect(try dec(#"{"t":"keepalive"}"#) == .keepalive)
        #expect(try dec(#"{"t":"requestIdr"}"#) == .requestIdr)
        #expect(try dec(#"{"t":"pause"}"#) == .pause)
        #expect(try dec(#"{"t":"resume"}"#) == .resume)
        #expect(try dec(#"{"t":"setTrackpad","enabled":true}"#) == .setTrackpad(true))
        #expect(try dec(#"{"t":"bye","reason":"user"}"#) == .bye(reason: "user"))
        #expect(try dec(#"{"t":"stats","rendered":10,"dropped":2,"decodeMsAvg":3.5}"#)
                == .stats(PhoneStats(rendered: 10, dropped: 2, decodeMsAvg: 3.5)))
    }

    @Test func resizeUsesSurfaceKeys() throws {
        #expect(try dec(#"{"t":"resize","surfaceW":1080,"surfaceH":2340,"orientation":"portrait"}"#)
                == .resize(w: 1080, h: 2340, orientation: .portrait))
    }

    @Test func knownTypeWithBadFieldsThrows() {
        #expect(throws: PhoneMessageError.invalid) { try dec(#"{"t":"ack"}"#) }
        #expect(throws: PhoneMessageError.invalid) { try dec(#"{"t":"ack","seq":"x"}"#) }
        #expect(throws: PhoneMessageError.invalid) { try dec(#"{"t":"resize","surfaceW":1,"surfaceH":2,"orientation":"diagonal"}"#) }
        #expect(throws: PhoneMessageError.invalid) { try dec(#"{"t":"setTrackpad"}"#) }
    }

    @Test func decodesInputWithOptionalCoordinates() throws {
        guard case .input(let e) = try dec(#"{"t":"input","e":"click"}"#) else { Issue.record("not input"); return }
        #expect(e.kind == .click)
        #expect(e.x == nil && e.y == nil && e.dx == nil && e.dy == nil)
        guard case .input(let s) = try dec(#"{"t":"input","e":"scroll","dx":0.1,"dy":-0.2}"#) else { Issue.record("not input"); return }
        #expect(s == InputEvent(kind: .scroll, x: nil, y: nil, dx: 0.1, dy: -0.2))
        guard case .input(let m) = try dec(#"{"t":"input","e":"move","x":0.5,"y":0.25}"#) else { Issue.record("not input"); return }
        #expect(m.x == 0.5 && m.y == 0.25)
    }

    @Test func inputUnknownEventKindIsIgnoredNotError() throws {
        guard case .input(let e) = try dec(#"{"t":"input","e":"pinch"}"#) else { Issue.record("not input"); return }
        #expect(e.kind == .unknown)
    }

    @Test func inputMissingEventThrows() {
        #expect(throws: PhoneMessageError.invalid) { try dec(#"{"t":"input"}"#) }
    }

    @Test func unknownTypeDecodesAsUnknown() throws {
        #expect(try dec(#"{"t":"zoom","level":2}"#) == .unknown("zoom"))
    }

    @Test func ignoresUnknownFieldsOnKnownTypes() throws {
        #expect(try dec(#"{"t":"ack","seq":5,"extra":true}"#) == .ack(seq: 5))
    }

    @Test func invalidJsonIsAnError() {
        #expect(throws: PhoneMessageError.invalid) { try dec("{not json") }
        #expect(throws: PhoneMessageError.invalid) { try dec(#"{"seq":1}"#) }
        #expect(throws: PhoneMessageError.invalid) { try dec(#"{"t":5}"#) }
        #expect(throws: PhoneMessageError.invalid) { try dec(#"[1,2]"#) }
        #expect(throws: PhoneMessageError.invalid) { try dec(#""hi""#) }
    }

    @Test func encodesHelperMessagesWithT() throws {
        func obj(_ m: HelperMessage) throws -> [String: Any] {
            let f = try Framing.json(m)
            return try #require(JSONSerialization.jsonObject(with: f.dropFirst(5)) as? [String: Any])
        }
        let sc = try obj(.streamConfig(w: 2340, h: 1080))
        #expect(sc["t"] as? String == "streamConfig")
        #expect(sc["w"] as? Int == 2340)
        #expect(sc["h"] as? Int == 1080)
        let ha = try obj(.helloAck(inputEnabled: true))
        #expect(ha["t"] as? String == "helloAck")
        #expect(ha["inputEnabled"] as? Bool == true)
        #expect(try obj(.keepalive)["t"] as? String == "keepalive")
        let end = try obj(.end(reason: "watchdog"))
        #expect(end["t"] as? String == "end")
        #expect(end["reason"] as? String == "watchdog")
    }
}
