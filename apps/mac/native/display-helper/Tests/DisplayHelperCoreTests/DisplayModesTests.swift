import CoreGraphics
import Testing
@testable import DisplayHelperCore

@Suite struct DisplayModesTests {
    @Test func landscapeModesForOnePlus6T() {
        let m = DisplayModes.modes(surfaceW: 2340, surfaceH: 1080)
        #expect(m.first == ModeSpec(widthPoints: 936, heightPoints: 432))
        #expect(m.count == 5)
        #expect(m.contains(ModeSpec(widthPoints: 2340, heightPoints: 1080)))
    }

    @Test func portraitSwapsAxesAndHonoursPreferredDivisor() {
        let m = DisplayModes.modes(surfaceW: 1080, surfaceH: 2340, preferredDivisor: 2.0)
        #expect(m.first == ModeSpec(widthPoints: 540, heightPoints: 1170))
        #expect(m.count == 5)
    }

    @Test func descriptorReservesBothOrientations() {
        #expect(DisplayModes.descriptorMaxPixels(surfaceW: 2340, surfaceH: 1080) == 4680)
        #expect(DisplayModes.descriptorMaxPixels(surfaceW: 5000, surfaceH: 3000) == 8192)
    }

    @Test func nearestDivisorRecoversTheChosenScale() {
        #expect(DisplayModes.nearestDivisor(currentWidthPoints: 1170, surfaceW: 2340) == 2.0)
        #expect(DisplayModes.nearestDivisor(currentWidthPoints: 940, surfaceW: 2340) == 2.5)
    }

    @Test func sizeInMillimetersFromDpi() {
        let s = DisplayModes.sizeInMillimeters(surfaceW: 2340, surfaceH: 1080, dpi: 402.0)
        #expect(abs(s.width - 147.8) < 0.1)
        #expect(abs(s.height - 68.2) < 0.1)
        #expect(DisplayModes.sizeInMillimeters(surfaceW: 2340, surfaceH: 1080, dpi: nil) == CGSize(width: 145, height: 67))
        #expect(DisplayModes.sizeInMillimeters(surfaceW: 1080, surfaceH: 2340, dpi: nil) == CGSize(width: 67, height: 145))
    }
}
