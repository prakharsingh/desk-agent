package com.deskagentapp.display

import java.io.ByteArrayInputStream
import java.io.DataInputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FrameCodecTest {
    private fun b(vararg v: Int) = ByteArray(v.size) { v[it].toByte() }
    private fun read(bytes: ByteArray) = FrameCodec.read(DataInputStream(ByteArrayInputStream(bytes)))

    @Test fun `reads a video frame written by the helper layout`() {
        val f = read(b(0, 0, 0, 0x0F, 1, 1, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 1, 0x65)) as WireFrame.Video
        assertEquals(1, f.flags); assertEquals(7L, f.seq)
        assertTrue(f.isKeyframe); assertFalse(f.isConfig)
        assertArrayEquals(b(0, 0, 0, 1, 0x65), f.payload)
    }

    // Golden vector: byte layout of Swift Framing.video(flags: [.config], seq: 0x8102030405060708 ...)
    // (hand-derived from Framing.swift: len=10+payload, kind, flags, u64be seq, payload).
    @Test fun `reads a config frame with a high-bit seq`() {
        val f = read(b(0, 0, 0, 0x0C, 1, 2, 0x81, 2, 3, 4, 5, 6, 7, 8, 0x67, 0x68)) as WireFrame.Video
        assertTrue(f.isConfig); assertFalse(f.isKeyframe)
        assertEquals(0x8102030405060708UL.toLong(), f.seq)
        assertArrayEquals(b(0x67, 0x68), f.payload)
    }

    @Test fun `reads a json frame and then the next frame from the same stream`() {
        val s = DataInputStream(ByteArrayInputStream(FrameCodec.encodeJson("{\"t\":\"a\"}") + FrameCodec.encodeJson("{}")))
        assertEquals(WireFrame.Json("{\"t\":\"a\"}"), FrameCodec.read(s))
        assertEquals(WireFrame.Json("{}"), FrameCodec.read(s))
    }

    @Test fun `encodes json with kind 0x02 and big-endian length`() {
        assertArrayEquals(byteArrayOf(0, 0, 0, 3, 2, '{'.code.toByte(), '}'.code.toByte()), FrameCodec.encodeJson("{}"))
    }

    @Test fun `encodes multibyte utf8 length in bytes`() {
        val e = FrameCodec.encodeJson("\"é\"") // 4 bytes of body
        assertEquals(5, e[3].toInt()); assertEquals(2, e[4].toInt())
    }

    @Test(expected = ProtocolException::class) fun `rejects oversize frames`() { read(b(0, 0x80, 0, 1, 2)) }
    @Test(expected = ProtocolException::class) fun `rejects zero length`() { read(b(0, 0, 0, 0, 2)) }
    @Test(expected = ProtocolException::class) fun `rejects unknown kinds`() { read(b(0, 0, 0, 2, 9, 0)) }
    @Test(expected = ProtocolException::class) fun `rejects a video frame shorter than its header`() {
        read(b(0, 0, 0, 9, 1, 1, 0, 0, 0, 0, 0, 0, 0))
    }
    @Test(expected = java.io.EOFException::class) fun `truncated stream surfaces EOF`() { read(b(0, 0, 0, 5, 2, 1)) }
}
