import Testing
@testable import DisplayHelperCore

@Suite struct StreamSizingTests {
    @Test func streamSizeFitsDecoderLimits() {
        let s = StreamSizing.streamSize(surfaceW: 2340, surfaceH: 1080, maxW: 1920, maxH: 1920)
        #expect(s.w == 1920)
        #expect(s.h == 886)
    }

    @Test func streamSizeNeverUpscalesAndStaysEven() {
        let s = StreamSizing.streamSize(surfaceW: 1001, surfaceH: 501, maxW: 4000, maxH: 4000)
        #expect(s.w == 1000)
        #expect(s.h == 500)
    }
}
