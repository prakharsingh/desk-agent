package com.deskagentapp.display

/** Annex-B (start-code-prefixed) H.264 helpers. NAL units are returned without their start codes. */
object AnnexB {
    /** Splits on 3- or 4-byte start codes. Data before the first start code is ignored. */
    fun splitNalUnits(data: ByteArray): List<ByteArray> {
        val starts = ArrayList<Int>() // index of the first byte after each start code
        var i = 0
        while (i + 2 < data.size) {
            if (data[i].toInt() == 0 && data[i + 1].toInt() == 0 && data[i + 2].toInt() == 1) {
                starts.add(i + 3); i += 3
            } else i++
        }
        return starts.mapIndexedNotNull { n, s ->
            var end = if (n + 1 < starts.size) starts[n + 1] - 3 else data.size
            // a 4-byte start code leaves one trailing zero on the previous NAL
            if (n + 1 < starts.size && end > s && data[end - 1].toInt() == 0) end--
            if (end <= s) null else data.copyOfRange(s, end) // skip empty NALs
        }
    }

    fun nalType(nal: ByteArray): Int = nal[0].toInt() and 0x1F

    /** First SPS (type 7) and PPS (type 8) of a config frame. */
    fun spsPps(config: ByteArray): Pair<ByteArray, ByteArray> {
        val nals = splitNalUnits(config)
        val sps = nals.firstOrNull { nalType(it) == 7 }
        val pps = nals.firstOrNull { nalType(it) == 8 }
        if (sps == null || pps == null) throw ProtocolException("config frame lacks SPS/PPS")
        return sps to pps
    }
}
