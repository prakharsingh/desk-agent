package com.deskagentapp.display

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

fun orientationOf(w: Int, h: Int): String = if (w >= h) "landscape" else "portrait"

sealed class HelperMessage {
    data class HelloAck(val inputEnabled: Boolean) : HelperMessage()
    data class StreamConfig(val w: Int, val h: Int) : HelperMessage()
    object Keepalive : HelperMessage()
    data class End(val reason: String) : HelperMessage()
    data class Unknown(val t: String) : HelperMessage()
}

/** Contract D JSON messages (phone -> helper builders, helper -> phone parser). */
object ControlMessages {
    private fun msg(t: String, build: JSONObject.() -> Unit = {}): String =
        JSONObject().apply { put("t", t); build() }.toString()

    fun hello(token: String, sessionId: String, surfaceW: Int, surfaceH: Int, maxW: Int, maxH: Int, trackpad: Boolean) =
        msg("hello") {
            put("v", 1); put("token", token); put("sessionId", sessionId)
            put("surfaceW", surfaceW); put("surfaceH", surfaceH)
            put("orientation", orientationOf(surfaceW, surfaceH))
            put("codecs", JSONArray().put("h264"))
            put("maxW", maxW); put("maxH", maxH); put("trackpad", trackpad)
        }

    fun keepalive() = msg("keepalive")
    /** [seq] is cumulative: the highest seq finished with, rendered or dropped. */
    fun ack(seq: Long) = msg("ack") { put("seq", seq) }
    fun requestIdr() = msg("requestIdr")
    fun resize(w: Int, h: Int) = msg("resize") {
        put("surfaceW", w); put("surfaceH", h); put("orientation", orientationOf(w, h))
    }
    fun pause() = msg("pause")
    fun resume() = msg("resume")
    fun setTrackpad(enabled: Boolean) = msg("setTrackpad") { put("enabled", enabled) }
    fun stats(rendered: Long, dropped: Long, decodeMsAvg: Double) = msg("stats") {
        put("rendered", rendered); put("dropped", dropped); put("decodeMsAvg", if (decodeMsAvg.isFinite()) decodeMsAvg else 0.0)
    }
    fun bye(reason: String) = msg("bye") { put("reason", reason) }

    /** Unknown `t` -> Unknown; unknown fields ignored; bad JSON / no string `t` / missing required field -> ProtocolException. */
    fun parse(text: String): HelperMessage {
        try {
            val j = JSONObject(text)
            val t = j.opt("t") as? String ?: throw ProtocolException("missing string t")
            return when (t) {
                "helloAck" -> HelperMessage.HelloAck(j.getBoolean("inputEnabled"))
                "streamConfig" -> HelperMessage.StreamConfig(j.getInt("w"), j.getInt("h"))
                "keepalive" -> HelperMessage.Keepalive
                "end" -> HelperMessage.End(j.getString("reason"))
                else -> HelperMessage.Unknown(t)
            }
        } catch (e: JSONException) {
            throw ProtocolException("bad control message: ${e.message}")
        }
    }
}
