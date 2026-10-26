package com.deskagentapp.display

import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build

data class CodecCandidate(
    val name: String,
    val hardware: Boolean,
    val softwareOnly: Boolean,
    val maxW: Int,
    val maxH: Int,
    val supportsSize: (Int, Int) -> Boolean,
)

object DecoderSelector {
    private fun isSoftwareName(name: String): Boolean {
        val n = name.lowercase()
        return n.startsWith("omx.google.") || n.startsWith("c2.android.")
    }

    private fun rank(name: String): Int {
        val n = name.lowercase()
        return when {
            n.startsWith("c2.qti") -> 0
            n.startsWith("omx.qcom") -> 1
            else -> 2
        }
    }

    /** Best hardware decoder that supports [w]x[h], or null. Stable: ties keep list order. */
    fun choose(candidates: List<CodecCandidate>, w: Int, h: Int): CodecCandidate? =
        candidates
            .filter { it.hardware && !it.softwareOnly && !isSoftwareName(it.name) }
            .filter { it.supportsSize(w, h) }
            .minByOrNull { rank(it.name) }

    fun fromMediaCodecList(): List<CodecCandidate> =
        MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
            .filter { !it.isEncoder && it.supportedTypes.any { t -> t.equals(MediaFormat.MIMETYPE_VIDEO_AVC, true) } }
            .mapNotNull { info ->
                val type = info.supportedTypes.first { it.equals(MediaFormat.MIMETYPE_VIDEO_AVC, true) }
                val video = info.getCapabilitiesForType(type).videoCapabilities ?: return@mapNotNull null
                val byName = !isSoftwareName(info.name)
                val hardware = if (Build.VERSION.SDK_INT >= 29) info.isHardwareAccelerated else byName
                val softwareOnly = if (Build.VERSION.SDK_INT >= 29) info.isSoftwareOnly else !byName
                CodecCandidate(
                    name = info.name,
                    hardware = hardware,
                    softwareOnly = softwareOnly,
                    maxW = video.supportedWidths.upper,
                    maxH = video.supportedHeights.upper,
                    supportsSize = { w, h -> video.isSizeSupported(w, h) },
                )
            }
}
