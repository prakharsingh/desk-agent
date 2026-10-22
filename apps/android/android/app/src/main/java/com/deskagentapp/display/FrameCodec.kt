package com.deskagentapp.display

import java.io.DataInputStream
import java.io.EOFException

/** Contract D violation: bad framing or an unparseable control message. The caller closes the link. */
class ProtocolException(message: String) : Exception(message)

sealed class WireFrame {
    /** [payload] is Annex-B H.264; config frames (seq 0) carry SPS+PPS. */
    class Video(val flags: Int, val seq: Long, val payload: ByteArray) : WireFrame() {
        val isKeyframe get() = flags and FrameCodec.FLAG_KEYFRAME != 0
        val isConfig get() = flags and FrameCodec.FLAG_CONFIG != 0
    }
    data class Json(val text: String) : WireFrame()
}

/** Contract D framing: `len:u32be kind:u8 body[len-1]`; VIDEO body = `flags:u8 seq:u64be payload`. */
object FrameCodec {
    const val KIND_VIDEO = 0x01
    const val KIND_JSON = 0x02
    const val FLAG_KEYFRAME = 0x01
    const val FLAG_CONFIG = 0x02
    const val MAX_FRAME_LEN = 8_388_608
    private const val VIDEO_HEADER_LEN = 10 // kind + flags + seq

    fun encodeJson(json: String): ByteArray {
        val body = json.toByteArray(Charsets.UTF_8)
        val len = 1 + body.size
        val out = ByteArray(4 + len)
        out[0] = (len ushr 24).toByte(); out[1] = (len ushr 16).toByte()
        out[2] = (len ushr 8).toByte(); out[3] = len.toByte()
        out[4] = KIND_JSON.toByte()
        System.arraycopy(body, 0, out, 5, body.size)
        return out
    }

    /** Blocking. EOF mid-frame surfaces as [EOFException] (a socket close, not a protocol error). */
    fun read(input: DataInputStream): WireFrame {
        val len = input.readInt()
        // readInt is signed; a len with the top bit set is negative and thus also out of range.
        if (len <= 0) throw ProtocolException("bad frame length $len")
        if (len > MAX_FRAME_LEN) throw ProtocolException("frame too large: $len")
        val kind = input.readUnsignedByte()
        when (kind) {
            KIND_VIDEO -> {
                if (len < VIDEO_HEADER_LEN) throw ProtocolException("truncated video header (len $len)")
                val flags = input.readUnsignedByte()
                val seq = input.readLong()
                val payload = ByteArray(len - VIDEO_HEADER_LEN)
                input.readFully(payload)
                return WireFrame.Video(flags, seq, payload)
            }
            KIND_JSON -> {
                val body = ByteArray(len - 1)
                input.readFully(body)
                return WireFrame.Json(String(body, Charsets.UTF_8))
            }
            else -> throw ProtocolException("unknown frame kind $kind")
        }
    }
}
