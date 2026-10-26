import CoreMedia
import Foundation
import Testing
@testable import DisplayHelperSystem

/// Checkpoint 1 minor 8: a zero-length encoded block must be skipped, not trap on `baseAddress!`.
@Suite struct EncodedBufferTests {
    @Test func zeroLengthBlockIsSkipped() throws {
        var block: CMBlockBuffer?
        #expect(CMBlockBufferCreateEmpty(allocator: nil, capacity: 0, flags: 0, blockBufferOut: &block) == kCMBlockBufferNoErr)
        let empty = try #require(block)
        #expect(CMBlockBufferGetDataLength(empty) == 0)
        #expect(CaptureEncoder.copyBytes(of: empty) == nil)
    }

    @Test func nonEmptyBlockIsCopied() throws {
        let bytes: [UInt8] = [0, 0, 0, 1, 0x65, 0xAB]
        var block: CMBlockBuffer?
        #expect(CMBlockBufferCreateWithMemoryBlock(
            allocator: nil, memoryBlock: nil, blockLength: bytes.count, blockAllocator: nil,
            customBlockSource: nil, offsetToData: 0, dataLength: bytes.count, flags: 0,
            blockBufferOut: &block) == kCMBlockBufferNoErr)
        let b = try #require(block)
        #expect(bytes.withUnsafeBytes {
            CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: b, offsetIntoDestination: 0,
                                          dataLength: bytes.count)
        } == kCMBlockBufferNoErr)
        #expect(CaptureEncoder.copyBytes(of: b) == Data(bytes))
    }
}
