import Testing
@testable import DisplayHelperCore

@Suite struct DisplayIdentityTests {
    @Test func spareIsDeterministicAndDiffersFromThePrimary() {
        for s: UInt32 in [1, 2, 42, 0xb8af4884, 0xffff_ffff, DisplayIdentity.spareMask] {
            let spare = DisplayIdentity.spareSerial(for: s)
            #expect(spare == DisplayIdentity.spareSerial(for: s))
            #expect(spare != s)
            #expect(spare != 0)   // a zero serial makes macOS treat displays as interchangeable
        }
    }

    @Test func spareIsThePrimaryXorTheMask() {
        #expect(DisplayIdentity.spareSerial(for: 0xb8af4884) == 0xb8af4884 ^ DisplayIdentity.spareMask)
    }

    @Test func aZeroPrimaryIsTreatedAsTheSerialItBecomes() {
        // VirtualDisplayController turns serial 0 into 1, so the spare must differ from 1.
        #expect(DisplayIdentity.spareSerial(for: 0) == DisplayIdentity.spareSerial(for: 1))
        #expect(DisplayIdentity.spareSerial(for: 0) != 1)
    }
}
