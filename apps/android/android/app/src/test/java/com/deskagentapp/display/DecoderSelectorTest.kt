package com.deskagentapp.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DecoderSelectorTest {
    private fun c(
        name: String,
        hardware: Boolean = true,
        softwareOnly: Boolean = false,
        maxW: Int = 4096,
        maxH: Int = 4096,
        supports: (Int, Int) -> Boolean = { w, h -> w <= maxW && h <= maxH },
    ) = CodecCandidate(name, hardware, softwareOnly, maxW, maxH, supports)

    @Test fun `prefers c2 qti over omx qcom`() {
        val got = DecoderSelector.choose(
            listOf(c("OMX.qcom.video.decoder.avc"), c("c2.qti.avc.decoder"), c("OMX.other.avc")),
            1920, 1080,
        )
        assertEquals("c2.qti.avc.decoder", got?.name)
    }

    @Test fun `prefers omx qcom over other hardware`() {
        val got = DecoderSelector.choose(listOf(c("c2.exynos.avc.decoder"), c("OMX.qcom.video.decoder.avc")), 1920, 1080)
        assertEquals("OMX.qcom.video.decoder.avc", got?.name)
    }

    @Test fun `matches names case-insensitively`() {
        val got = DecoderSelector.choose(
            listOf(c("OMX.Google.h264.decoder"), c("OMX.qcom.video.decoder.avc"), c("C2.QTI.AVC.Decoder")),
            1920, 1080,
        )
        assertEquals("C2.QTI.AVC.Decoder", got?.name)
        val only = DecoderSelector.choose(listOf(c("OMX.Google.h264.decoder"), c("C2.Android.avc.decoder")), 1920, 1080)
        assertNull(only)
    }

    @Test fun `never picks a software decoder`() {
        val got = DecoderSelector.choose(
            listOf(c("c2.qti.avc.decoder.sw", hardware = false, softwareOnly = true), c("vendor.avc.decoder")),
            1920, 1080,
        )
        assertEquals("vendor.avc.decoder", got?.name)
    }

    @Test fun `skips a non-hardware decoder that is not flagged softwareOnly`() {
        val got = DecoderSelector.choose(
            listOf(c("vendor.generic.avc.decoder", hardware = false, softwareOnly = false), c("OMX.exynos.avc.dec")),
            1920, 1080,
        )
        assertEquals("OMX.exynos.avc.dec", got?.name)
        assertNull(DecoderSelector.choose(listOf(c("vendor.generic.avc.decoder", hardware = false)), 1920, 1080))
    }

    @Test fun `skips decoders that cannot do the size`() {
        val got = DecoderSelector.choose(
            listOf(c("c2.qti.avc.decoder", maxW = 1280, maxH = 720), c("OMX.qcom.video.decoder.avc")),
            1920, 1080,
        )
        assertEquals("OMX.qcom.video.decoder.avc", got?.name)
    }

    @Test fun `returns null when only software decoders exist`() {
        val got = DecoderSelector.choose(
            listOf(c("OMX.google.h264.decoder", hardware = false, softwareOnly = true), c("c2.android.avc.decoder", hardware = false)),
            1920, 1080,
        )
        assertNull(got)
    }
}
