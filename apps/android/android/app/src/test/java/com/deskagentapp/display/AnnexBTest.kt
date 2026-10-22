package com.deskagentapp.display

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class AnnexBTest {
    private fun b(vararg v: Int) = ByteArray(v.size) { v[it].toByte() }
    private val config = b(0, 0, 0, 1, 0x67, 1, 2, 0, 0, 0, 1, 0x68, 3)

    @Test fun `splits sps and pps from a config frame`() {
        val nals = AnnexB.splitNalUnits(config)
        assertEquals(2, nals.size)
        assertEquals(7, AnnexB.nalType(nals[0])); assertEquals(8, AnnexB.nalType(nals[1]))
        val (sps, pps) = AnnexB.spsPps(config)
        assertArrayEquals(b(0x67, 1, 2), sps); assertArrayEquals(b(0x68, 3), pps)
    }

    @Test fun `handles three-byte start codes`() {
        val nals = AnnexB.splitNalUnits(b(0, 0, 1, 0x65, 9, 0, 0, 0, 1, 0x41, 8))
        assertEquals(listOf(5, 1), nals.map { AnnexB.nalType(it) })
        assertArrayEquals(b(0x65, 9), nals[0])
    }

    @Test fun `no start code yields nothing`() { assertEquals(0, AnnexB.splitNalUnits(b(1, 2, 3)).size) }

    @Test fun `empty nals are skipped`() { assertEquals(0, AnnexB.splitNalUnits(b(0, 0, 1, 0, 0, 1)).size) }

    @Test(expected = ProtocolException::class) fun `spsPps requires both`() { AnnexB.spsPps(b(0, 0, 0, 1, 0x67, 1)) }
}
