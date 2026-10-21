// VideoToolbox session setup and the parameter-set extraction are adapted from SideScreen's
// MacHost VideoEncoder.swift (MIT, Copyright (c) 2025 Side Screen) — see THIRD_PARTY_NOTICES.md.

import CoreGraphics
import CoreMedia
import CoreVideo
import DisplayHelperCore
import Foundation
import ScreenCaptureKit
import VideoToolbox

/// ScreenCaptureKit capture of one display → VideoToolbox low-latency H.264 → Annex-B.
///
/// Threading: `queue` must be a serial queue. All state lives on it; every callback
/// (`onParameterSets`, `onFrame`, `onError`, `waitUntilCapturable`'s completion) runs on it, and
/// `shouldEncode` is called on it. Public methods may be called from any thread.
///
/// Video seq numbering is the caller's job (monotonic per session; config frames use seq 0).
public final class CaptureEncoder: NSObject, SCStreamOutput, SCStreamDelegate {
    public var shouldEncode: () -> Bool = { true }
    /// Annex-B SPS+PPS, width, height. Emitted before the first frame and whenever the format changes.
    public var onParameterSets: (Data, Int, Int) -> Void = { _, _, _ in }
    /// Annex-B access unit, isKeyframe.
    public var onFrame: (Data, Bool) -> Void = { _, _ in }
    public var onError: (Error) -> Void = { _ in }

    /// `.complete` samples received since `start` (probe counter).
    public private(set) var completeSamples: Int {
        get { counterLock.lock(); defer { counterLock.unlock() }; return _completeSamples }
        set { counterLock.lock(); _completeSamples = newValue; counterLock.unlock() }
    }

    private let queue: DispatchQueue
    private let queueKey = DispatchSpecificKey<UInt8>()
    private let bitrate: Int
    private let fps: Int
    private let counterLock = NSLock()
    private var _completeSamples = 0

    private var shareable: [UInt32: SCDisplay] = [:]
    private var stream: SCStream?
    private var streamConfig: SCStreamConfiguration?
    private var session: VTCompressionSession?
    private var gate: FrameGate
    private var held: CVPixelBuffer?
    private var lastPTS = CMTime.invalid
    private var lastFormat: CMFormatDescription?
    /// Bumped by start/stop so late VideoToolbox / SCStream callbacks from an old run are dropped.
    private var generation = 0

    public init(queue: DispatchQueue, bitrate: Int = 8_000_000, fps: Int = 60) {
        self.queue = queue
        self.bitrate = bitrate
        self.fps = fps
        self.gate = FrameGate(frameInterval: 1.0 / Double(fps))
        super.init()
        queue.setSpecific(key: queueKey, value: 1)
    }

    deinit {
        // No other references exist now; don't hand `self` to ScreenCaptureKit from deinit.
        stream?.stopCapture { _ in }
        teardownSession()
    }

    private var frameInterval: TimeInterval { 1.0 / Double(fps) }
    private static func now() -> TimeInterval { ProcessInfo.processInfo.systemUptime }

    private static func log(_ s: String) {
        Stderr.diag("capture: \(s)")
    }

    private func onQueue<T>(_ body: () throws -> T) rethrows -> T {
        if DispatchQueue.getSpecific(key: queueKey) != nil { return try body() }
        return try queue.sync(execute: body)
    }

    // MARK: - Feature detect

    private static func isOnline(_ id: UInt32) -> Bool {
        var ids = [CGDirectDisplayID](repeating: 0, count: 32)
        var n: UInt32 = 0
        guard CGGetOnlineDisplayList(32, &ids, &n) == .success else { return false }
        return ids.prefix(Int(n)).contains(id)
    }

    private static func isUserDeclined(_ error: Error) -> Bool {
        let e = error as NSError
        return e.domain == SCStreamErrorDomain && e.code == SCStreamError.Code.userDeclined.rawValue
    }

    /// Polls every 250 ms until the display is online AND listed in `SCShareableContent`.
    /// Timeout → `.unsupported` (never online) or `.captureUnavailable` (online, never shareable);
    /// `userDeclined` → `.permissionDenied`. Completion runs on `queue`.
    public func waitUntilCapturable(
        displayId: UInt32, timeout: TimeInterval,
        completion: @escaping (Result<Void, BackendError>) -> Void
    ) {
        let deadline = Self.now() + timeout
        var everOnline = false

        func retry() {
            if Self.now() >= deadline {
                completion(.failure(BackendError.capturableTimeout(everOnline: everOnline)))
            } else {
                queue.asyncAfter(deadline: .now() + 0.25, execute: poll)
            }
        }
        func poll() {
            guard Self.isOnline(displayId) else { return retry() }
            everOnline = true
            SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: false) { [weak self] content, error in
                guard let self else { return }
                self.queue.async {
                    if let error, Self.isUserDeclined(error) { return completion(.failure(.permissionDenied)) }
                    if let d = content?.displays.first(where: { $0.displayID == displayId }) {
                        self.shareable[displayId] = d
                        return completion(.success(()))
                    }
                    retry()
                }
            }
        }
        queue.async(execute: poll)
    }

    // MARK: - Start / stop

    /// Requires a successful `waitUntilCapturable` for `displayId` first. `width`/`height` is the
    /// stream (encode) size. Asynchronous start failures arrive via `onError` as `BackendError`.
    public func start(displayId: UInt32, width: Int, height: Int, showsCursor: Bool) throws {
        try onQueue {
            stopLocked()
            guard let display = shareable[displayId] else { throw BackendError.captureUnavailable }
            generation += 1
            completeSamples = 0
            try makeSession(width: width, height: height)

            let config = SCStreamConfiguration()
            config.width = width
            config.height = height
            config.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
            config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
            config.queueDepth = 3
            config.showsCursor = showsCursor
            config.colorMatrix = CGDisplayStream.yCbCrMatrix_ITU_R_709_2
            let filter = SCContentFilter(display: display, excludingWindows: [])
            let s = SCStream(filter: filter, configuration: config, delegate: self)
            do {
                try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
            } catch {
                teardownSession()
                throw BackendError.captureFailed("addStreamOutput: \(error.localizedDescription)")
            }
            stream = s
            streamConfig = config
            let gen = generation
            s.startCapture { [weak self] error in
                guard let self, let error else { return }
                self.queue.async {
                    guard gen == self.generation else { return }
                    Self.log("startCapture failed: \(error)")
                    self.onError(Self.isUserDeclined(error)
                        ? BackendError.permissionDenied
                        : BackendError.captureFailed("startCapture: \(error.localizedDescription)"))
                }
            }
        }
    }

    public func stop() { onQueue { stopLocked() } }

    private func stopLocked() {
        generation += 1
        if let s = stream {
            s.stopCapture { _ in }
            try? s.removeStreamOutput(self, type: .screen)
        }
        stream = nil
        streamConfig = nil
        teardownSession()
        held = nil
        lastFormat = nil
        lastPTS = .invalid
        gate = FrameGate(frameInterval: frameInterval)
    }

    public func setShowsCursor(_ on: Bool) {
        queue.async {
            guard let s = self.stream, let c = self.streamConfig, c.showsCursor != on else { return }
            c.showsCursor = on
            s.updateConfiguration(c) { error in
                if let error { Self.log("updateConfiguration(showsCursor) failed: \(error)") }
            }
        }
    }

    // MARK: - Flow control / keyframes

    /// FrameGate.keyframeForced + a one-shot timer at one frame interval: if no new sample came
    /// (static screen), the held buffer is re-encoded as an IDR.
    public func forceKeyframe() {
        queue.async {
            self.gate.keyframeForced(at: Self.now())
            let gen = self.generation
            self.queue.asyncAfter(deadline: .now() + self.frameInterval + 0.001) {
                guard gen == self.generation else { return }
                if self.gate.tick(at: Self.now(), canSend: self.shouldEncode()) { self.encodeHeld(forceKeyframe: true) }
            }
        }
    }

    /// Called when an ack reopens the flow-control window: encodes the held buffer if it was never
    /// encoded (or re-encodes it as an IDR if a forced keyframe is still owed on a static screen).
    public func unblocked() {
        queue.async {
            let t = Self.now()
            let idr = self.gate.keyframePending
            if self.gate.unblocked(at: t) {
                self.encodeHeld(forceKeyframe: idr)
            } else if self.gate.tick(at: t, canSend: self.shouldEncode()) {
                self.encodeHeld(forceKeyframe: true)
            }
        }
    }

    // MARK: - SCStreamOutput / SCStreamDelegate (on `queue`)

    public func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, stream === self.stream, CMSampleBufferIsValid(sampleBuffer) else { return }
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
                as? [[SCStreamFrameInfo: Any]],
              let raw = attachments.first?[.status] as? Int,
              SCFrameStatus(rawValue: raw) == .complete,
              let pb = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        completeSamples += 1
        held = pb
        let idr = gate.keyframePending
        if gate.sampleArrived(at: Self.now(), canSend: shouldEncode()) { encodeHeld(forceKeyframe: idr) }
    }

    public func stream(_ stream: SCStream, didStopWithError error: Error) {
        queue.async {
            guard stream === self.stream else { return }
            Self.log("stream stopped: \(error)")
            self.onError(Self.isUserDeclined(error)
                ? BackendError.permissionDenied
                : BackendError.captureFailed("stream stopped: \(error.localizedDescription)"))
        }
    }

    // MARK: - VideoToolbox

    private func makeSession(width: Int, height: Int) throws {
        var s: VTCompressionSession?
        let lowLatency = [kVTVideoEncoderSpecification_EnableLowLatencyRateControl: kCFBooleanTrue] as CFDictionary
        var status = VTCompressionSessionCreate(
            allocator: nil, width: Int32(width), height: Int32(height), codecType: kCMVideoCodecType_H264,
            encoderSpecification: lowLatency, imageBufferAttributes: nil, compressedDataAllocator: nil,
            outputCallback: nil, refcon: nil, compressionSessionOut: &s)
        if status != noErr || s == nil {
            Self.log("low-latency rate control refused (\(status)); using the default encoder")
            status = VTCompressionSessionCreate(
                allocator: nil, width: Int32(width), height: Int32(height), codecType: kCMVideoCodecType_H264,
                encoderSpecification: nil, imageBufferAttributes: nil, compressedDataAllocator: nil,
                outputCallback: nil, refcon: nil, compressionSessionOut: &s)
        }
        guard status == noErr, let session = s else {
            throw BackendError.captureFailed("VTCompressionSessionCreate: \(status)")
        }

        func set(_ key: CFString, _ value: CFTypeRef) {
            let st = VTSessionSetProperty(session, key: key, value: value)
            if st != noErr { Self.log("VTSessionSetProperty \(key) refused: \(st)") }
        }
        set(kVTCompressionPropertyKey_RealTime, kCFBooleanTrue)
        if VTSessionSetProperty(session, key: kVTCompressionPropertyKey_ProfileLevel,
                                value: kVTProfileLevel_H264_High_AutoLevel) == noErr {
            Self.log("profile: H264_High_AutoLevel")
        } else {
            let st = VTSessionSetProperty(session, key: kVTCompressionPropertyKey_ProfileLevel,
                                          value: kVTProfileLevel_H264_ConstrainedHigh_AutoLevel)
            Self.log(st == noErr ? "profile: H264_ConstrainedHigh_AutoLevel (High refused)"
                                 : "profile: encoder default (High and ConstrainedHigh refused: \(st))")
        }
        set(kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse)
        set(kVTCompressionPropertyKey_MaxFrameDelayCount, 0 as CFNumber)
        set(kVTCompressionPropertyKey_MaxKeyFrameInterval, 36_000 as CFNumber)   // no periodic IDR
        set(kVTCompressionPropertyKey_ExpectedFrameRate, fps as CFNumber)
        set(kVTCompressionPropertyKey_AverageBitRate, bitrate as CFNumber)
        set(kVTCompressionPropertyKey_ColorPrimaries, kCVImageBufferColorPrimaries_ITU_R_709_2)
        set(kVTCompressionPropertyKey_TransferFunction, kCVImageBufferTransferFunction_ITU_R_709_2)
        set(kVTCompressionPropertyKey_YCbCrMatrix, kCVImageBufferYCbCrMatrix_ITU_R_709_2)

        let prep = VTCompressionSessionPrepareToEncodeFrames(session)
        if prep != noErr {
            VTCompressionSessionInvalidate(session)
            throw BackendError.captureFailed("VTCompressionSessionPrepareToEncodeFrames: \(prep)")
        }
        self.session = session
    }

    private func teardownSession() {
        guard let s = session else { return }
        VTCompressionSessionCompleteFrames(s, untilPresentationTimeStamp: .invalid)
        VTCompressionSessionInvalidate(s)
        session = nil
    }

    /// Encodes the held buffer. PTS comes from our own monotonic clock so re-encoding the same
    /// buffer still gets a strictly increasing timestamp.
    private func encodeHeld(forceKeyframe: Bool) {
        guard let session, let pb = held else { return }
        var pts = CMTime(seconds: Self.now(), preferredTimescale: 1_000_000)
        if lastPTS.isValid, pts <= lastPTS { pts = CMTimeAdd(lastPTS, CMTime(value: 1, timescale: 1_000_000)) }
        lastPTS = pts
        let props = forceKeyframe ? [kVTEncodeFrameOptionKey_ForceKeyFrame: kCFBooleanTrue] as CFDictionary : nil
        let gen = generation
        let status = VTCompressionSessionEncodeFrame(
            session, imageBuffer: pb, presentationTimeStamp: pts, duration: .invalid,
            frameProperties: props, infoFlagsOut: nil
        ) { [weak self] status, flags, sample in
            self?.handleEncoded(status: status, flags: flags, sample: sample, generation: gen)
        }
        if status != noErr {
            onError(BackendError.captureFailed("VTCompressionSessionEncodeFrame: \(status)"))
        }
    }

    /// The encoded block's bytes; nil when it is empty or the copy fails. The empty guard matters:
    /// `baseAddress` of an empty buffer may be nil, and force-unwrapping it would trap.
    static func copyBytes(of block: CMBlockBuffer) -> Data? {
        let length = CMBlockBufferGetDataLength(block)
        guard length > 0 else { return nil }
        var out = Data(count: length)
        let copy = out.withUnsafeMutableBytes { buf -> OSStatus in
            guard let base = buf.baseAddress else { return kCMBlockBufferBadPointerParameterErr }
            return CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: base)
        }
        return copy == kCMBlockBufferNoErr ? out : nil
    }

    /// Runs on a VideoToolbox thread; converts there, emits on `queue` (order is preserved because
    /// VideoToolbox delivers a session's outputs serially and `queue` is serial).
    private func handleEncoded(status: OSStatus, flags: VTEncodeInfoFlags, sample: CMSampleBuffer?, generation gen: Int) {
        if status != noErr {
            queue.async {
                guard gen == self.generation else { return }
                self.onError(BackendError.captureFailed("encode callback: \(status)"))
            }
            return
        }
        guard !flags.contains(.frameDropped), let sample, let format = CMSampleBufferGetFormatDescription(sample),
              let block = CMSampleBufferGetDataBuffer(sample) else { return }

        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]]
        let isKeyframe = !((attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool) ?? false)

        guard let avcc = Self.copyBytes(of: block) else { return }

        var count = 0
        var nalHeaderLength: Int32 = 4
        CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            format, parameterSetIndex: 0, parameterSetPointerOut: nil, parameterSetSizeOut: nil,
            parameterSetCountOut: &count, nalUnitHeaderLengthOut: &nalHeaderLength)

        let annexB: Data
        do {
            annexB = try AnnexB.fromAVCC(avcc, nalLengthSize: Int(nalHeaderLength))
        } catch {
            queue.async {
                guard gen == self.generation else { return }
                self.onError(BackendError.captureFailed("AVCC→Annex-B: \(error)"))
            }
            return
        }

        queue.async {
            guard gen == self.generation else { return }
            if self.lastFormat.map({ !CMFormatDescriptionEqual($0, otherFormatDescription: format) }) ?? true {
                self.lastFormat = format
                var sps: [Data] = [], pps: [Data] = []
                for i in 0..<count {
                    var ptr: UnsafePointer<UInt8>?
                    var size = 0
                    guard CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
                        format, parameterSetIndex: i, parameterSetPointerOut: &ptr, parameterSetSizeOut: &size,
                        parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil) == noErr,
                          let ptr, size > 0 else { continue }
                    let nal = Data(bytes: ptr, count: size)
                    if nal[0] & 0x1F == 7 { sps.append(nal) } else { pps.append(nal) }
                }
                let dims = CMVideoFormatDescriptionGetDimensions(format)
                self.onParameterSets(AnnexB.parameterSets(sps: sps, pps: pps), Int(dims.width), Int(dims.height))
            }
            self.onFrame(annexB, isKeyframe)
        }
    }
}
