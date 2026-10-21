import Foundation
import Testing
@testable import DisplayHelperCore

@Suite struct AnnexBTests {
    @Test func fromAVCCConvertsLengthPrefixesToStartCodes() throws {
        let avcc = Data([0, 0, 0, 2, 0x65, 0x88, 0, 0, 0, 1, 0x41])
        #expect(try AnnexB.fromAVCC(avcc) == Data([0, 0, 0, 1, 0x65, 0x88, 0, 0, 0, 1, 0x41]))
    }

    @Test func fromAVCCSupportsShorterLengthFields() throws {
        let avcc = Data([0, 2, 0x65, 0x88])
        #expect(try AnnexB.fromAVCC(avcc, nalLengthSize: 2) == Data([0, 0, 0, 1, 0x65, 0x88]))
    }

    @Test func fromAVCCOfEmptyDataIsEmpty() throws {
        #expect(try AnnexB.fromAVCC(Data()) == Data())
    }

    @Test func truncatedLengthPrefixThrows() {
        #expect(throws: AnnexBError.truncated) {
            try AnnexB.fromAVCC(Data([0, 0, 0, 1, 0x41, 0, 0]))
        }
    }

    @Test func nalLongerThanRemainingDataThrows() {
        #expect(throws: AnnexBError.truncated) {
            try AnnexB.fromAVCC(Data([0, 0, 0, 5, 0x65, 0x88]))
        }
    }

    @Test func unsupportedLengthSizeThrows() {
        #expect(throws: AnnexBError.badLengthSize(3)) {
            try AnnexB.fromAVCC(Data([0, 0, 1, 0x41]), nalLengthSize: 3)
        }
    }

    @Test func parameterSetsArePrefixedWithStartCodes() {
        #expect(AnnexB.parameterSets(sps: [Data([0x67, 1])], pps: [Data([0x68, 2])])
            == Data([0, 0, 0, 1, 0x67, 1, 0, 0, 0, 1, 0x68, 2]))
    }
}

@Suite struct BackendErrorTests {
    @Test func timeoutMapsToUnsupportedWhenNeverOnline() {
        #expect(BackendError.capturableTimeout(everOnline: false) == .unsupported)
    }

    @Test func timeoutMapsToCaptureUnavailableWhenOnlineButNotShareable() {
        #expect(BackendError.capturableTimeout(everOnline: true) == .captureUnavailable)
    }

    @Test func captureFailedCarriesItsMessage() {
        #expect(BackendError.captureFailed("a") != BackendError.captureFailed("b"))
        #expect(BackendError.captureFailed("a") == BackendError.captureFailed("a"))
    }
}
