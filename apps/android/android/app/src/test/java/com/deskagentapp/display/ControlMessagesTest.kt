package com.deskagentapp.display

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ControlMessagesTest {
    @Test fun `unknown helper types parse as Unknown and extra fields are ignored`() {
        assertEquals(HelperMessage.Unknown("cursor"), ControlMessages.parse("""{"t":"cursor","x":1}"""))
        assertEquals(HelperMessage.HelloAck(true), ControlMessages.parse("""{"t":"helloAck","inputEnabled":true,"future":1}"""))
    }

    @Test fun `parses the additive inputState`() {
        assertEquals(HelperMessage.InputState(true), ControlMessages.parse("""{"t":"inputState","inputEnabled":true}"""))
        assertEquals(HelperMessage.InputState(false), ControlMessages.parse("""{"t":"inputState","inputEnabled":false}"""))
    }

    @Test fun `hello carries token session size and h264`() {
        val j = JSONObject(ControlMessages.hello("tok", "s1", 2340, 1080, 4096, 2304, false))
        assertEquals("hello", j.getString("t")); assertEquals(1, j.getInt("v"))
        assertEquals("tok", j.getString("token")); assertEquals("s1", j.getString("sessionId"))
        assertEquals(2340, j.getInt("surfaceW")); assertEquals(1080, j.getInt("surfaceH"))
        assertEquals(4096, j.getInt("maxW")); assertEquals(2304, j.getInt("maxH"))
        assertFalse(j.getBoolean("trackpad"))
        assertEquals("landscape", j.getString("orientation"))
        assertEquals(1, j.getJSONArray("codecs").length())
        assertEquals("h264", j.getJSONArray("codecs").getString(0))
    }

    @Test fun `resize uses the contract keys`() {
        val j = JSONObject(ControlMessages.resize(1080, 2340))
        assertEquals("resize", j.getString("t"))
        assertEquals(1080, j.getInt("surfaceW")); assertEquals(2340, j.getInt("surfaceH"))
        assertEquals("portrait", j.getString("orientation"))
    }

    @Test fun `orientation of a square is landscape`() { assertEquals("landscape", orientationOf(100, 100)) }

    @Test fun `simple messages have the contract shape`() {
        assertEquals("keepalive", JSONObject(ControlMessages.keepalive()).getString("t"))
        assertEquals("requestIdr", JSONObject(ControlMessages.requestIdr()).getString("t"))
        assertEquals("pause", JSONObject(ControlMessages.pause()).getString("t"))
        assertEquals("resume", JSONObject(ControlMessages.resume()).getString("t"))
        val a = JSONObject(ControlMessages.ack(5_000_000_000L))
        assertEquals("ack", a.getString("t")); assertEquals(5_000_000_000L, a.getLong("seq"))
        val tp = JSONObject(ControlMessages.setTrackpad(true))
        assertEquals("setTrackpad", tp.getString("t")); assertTrue(tp.getBoolean("enabled"))
        val s = JSONObject(ControlMessages.stats(10, 2, 3.5))
        assertEquals("stats", s.getString("t")); assertEquals(10L, s.getLong("rendered"))
        assertEquals(2L, s.getLong("dropped")); assertEquals(3.5, s.getDouble("decodeMsAvg"), 0.0)
        val bye = JSONObject(ControlMessages.bye("user-stop"))
        assertEquals("bye", bye.getString("t")); assertEquals("user-stop", bye.getString("reason"))
    }

    @Test fun `input omits null coordinates`() {
        val c = JSONObject(ControlMessages.input(SemanticEvent.Click(null, null)))
        assertEquals("input", c.getString("t")); assertEquals("click", c.getString("e"))
        assertFalse(c.has("x")); assertFalse(c.has("y")); assertFalse(c.has("dx")); assertFalse(c.has("dy"))
        val r = JSONObject(ControlMessages.input(SemanticEvent.RightClick(null, null)))
        assertEquals("rightClick", r.getString("e")); assertFalse(r.has("x")); assertFalse(r.has("y"))
        val at = JSONObject(ControlMessages.input(SemanticEvent.Click(0.5f, 0.25f)))
        assertEquals(0.5, at.getDouble("x"), 0.0); assertEquals(0.25, at.getDouble("y"), 0.0)
        assertFalse(at.has("dx"))
        assertEquals("""{"t":"input","e":"click","x":0.5,"y":0.25}""", ControlMessages.input(SemanticEvent.Click(0.5f, 0.25f)))
    }

    @Test fun `input names match the contract`() {
        fun j(e: SemanticEvent) = JSONObject(ControlMessages.input(e))
        val cases = listOf(
            SemanticEvent.Click(0.5f, 0.5f) to "click",
            SemanticEvent.RightClick(0.5f, 0.5f) to "rightClick",
            SemanticEvent.DragStart(0.5f, 0.5f) to "dragStart",
            SemanticEvent.DragMove(0.5f, 0.5f) to "dragMove",
            SemanticEvent.DragEnd(0.5f, 0.5f) to "dragEnd",
            SemanticEvent.Scroll(0.125f, -0.25f) to "scroll",
            SemanticEvent.Move(0.125f, -0.25f) to "move",
        )
        for ((e, name) in cases) {
            val o = j(e)
            assertEquals("input", o.getString("t")); assertEquals(name, o.getString("e"))
        }
        val drag = j(SemanticEvent.DragMove(0.75f, 0.125f))
        assertEquals(0.75, drag.getDouble("x"), 0.0); assertEquals(0.125, drag.getDouble("y"), 0.0)
        assertFalse(drag.has("dx"))
        val scroll = j(SemanticEvent.Scroll(0.125f, -0.25f))
        assertEquals(0.125, scroll.getDouble("dx"), 0.0); assertEquals(-0.25, scroll.getDouble("dy"), 0.0)
        assertFalse(scroll.has("x")); assertFalse(scroll.has("y"))
        val abs = j(SemanticEvent.Scroll(0.125f, -0.25f, 0.5f, 0.75f))
        assertEquals(0.5, abs.getDouble("x"), 0.0); assertEquals(0.75, abs.getDouble("y"), 0.0)
        assertEquals(0.125, abs.getDouble("dx"), 0.0); assertEquals(-0.25, abs.getDouble("dy"), 0.0)
        val move = j(SemanticEvent.Move(-0.5f, 0.25f))
        assertEquals(-0.5, move.getDouble("dx"), 0.0); assertEquals(0.25, move.getDouble("dy"), 0.0)
    }

    @Test fun `stats coerces non-finite decodeMsAvg to zero`() {
        assertEquals(0.0, JSONObject(ControlMessages.stats(1, 0, Double.NaN)).getDouble("decodeMsAvg"), 0.0)
        assertEquals(0.0, JSONObject(ControlMessages.stats(1, 0, Double.POSITIVE_INFINITY)).getDouble("decodeMsAvg"), 0.0)
    }

    @Test fun `parses streamConfig keepalive and end`() {
        assertEquals(HelperMessage.StreamConfig(2340, 1080), ControlMessages.parse("""{"t":"streamConfig","w":2340,"h":1080}"""))
        assertEquals(HelperMessage.Keepalive, ControlMessages.parse("""{"t":"keepalive"}"""))
        assertEquals(HelperMessage.End("version-mismatch"), ControlMessages.parse("""{"t":"end","reason":"version-mismatch"}"""))
    }

    @Test(expected = ProtocolException::class) fun `invalid json is a protocol error`() { ControlMessages.parse("nope") }
    @Test(expected = ProtocolException::class) fun `missing t is a protocol error`() { ControlMessages.parse("""{"x":1}""") }
    @Test(expected = ProtocolException::class) fun `non-string t is a protocol error`() { ControlMessages.parse("""{"t":3}""") }
    @Test(expected = ProtocolException::class) fun `non-object is a protocol error`() { ControlMessages.parse("[1]") }
    @Test(expected = ProtocolException::class) fun `known type missing required field is a protocol error`() {
        ControlMessages.parse("""{"t":"streamConfig","w":1}""")
    }
}
