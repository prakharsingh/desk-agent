package com.deskagentapp.display

import com.deskagentapp.display.SemanticEvent.Click
import com.deskagentapp.display.SemanticEvent.DragEnd
import com.deskagentapp.display.SemanticEvent.DragMove
import com.deskagentapp.display.SemanticEvent.DragStart
import com.deskagentapp.display.SemanticEvent.Move
import com.deskagentapp.display.SemanticEvent.RightClick
import com.deskagentapp.display.SemanticEvent.Scroll
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GestureRecognizerTest {
    private val w = 1000
    private val h = 2000
    private val slop = 10f
    private val longPress = 500L

    private fun g(trackpad: Boolean = false) = GestureRecognizer(slop, longPress, trackpad)

    private fun s(action: TouchAction, t: Long, vararg p: Pair<Float, Float>) =
        TouchSample(action, p.toList(), w, h, t)

    private fun GestureRecognizer.down(x: Float, y: Float, t: Long = 0) = onTouch(s(TouchAction.DOWN, t, x to y))
    private fun GestureRecognizer.move(x: Float, y: Float, t: Long) = onTouch(s(TouchAction.MOVE, t, x to y))
    private fun GestureRecognizer.up(x: Float, y: Float, t: Long) = onTouch(s(TouchAction.UP, t, x to y))

    private fun assertEvents(expected: List<SemanticEvent>, actual: List<SemanticEvent>, eps: Float = 1e-4f) {
        assertEquals("size: $actual", expected.size, actual.size)
        expected.zip(actual).forEach { (e, a) ->
            assertEquals(e::class, a::class)
            when (e) {
                is Click -> { a as Click; near(e.x, a.x, eps); near(e.y, a.y, eps) }
                is RightClick -> { a as RightClick; near(e.x, a.x, eps); near(e.y, a.y, eps) }
                is DragStart -> { a as DragStart; near(e.x, a.x, eps); near(e.y, a.y, eps) }
                is DragMove -> { a as DragMove; near(e.x, a.x, eps); near(e.y, a.y, eps) }
                is DragEnd -> { a as DragEnd; near(e.x, a.x, eps); near(e.y, a.y, eps) }
                is Scroll -> { a as Scroll; near(e.dx, a.dx, eps); near(e.dy, a.dy, eps); near(e.x, a.x, eps); near(e.y, a.y, eps) }
                is Move -> { a as Move; near(e.dx, a.dx, eps); near(e.dy, a.dy, eps) }
            }
        }
    }

    private fun near(e: Float?, a: Float?, eps: Float) {
        if (e == null) assertNull(a) else assertEquals(e, a ?: Float.NaN, eps)
    }

    @Test
    fun `tap within slop is a click at the down point`() {
        val r = g()
        assertTrue(r.down(500f, 1000f).isEmpty())
        assertTrue(r.move(503f, 1002f, 50).isEmpty())
        assertEvents(listOf(Click(0.5f, 0.5f)), r.up(503f, 1002f, 100))
    }

    @Test
    fun `no mouse-down until movement passes slop`() {
        val r = g()
        r.down(100f, 200f)
        assertTrue(r.move(105f, 200f, 20).isEmpty())
        assertTrue(r.move(109f, 200f, 40).isEmpty())
        val out = r.move(112f, 200f, 60)
        assertTrue(out.first() is DragStart)
    }

    @Test
    fun `drag emits start move end in order`() {
        val r = g()
        r.down(100f, 200f)
        assertEvents(
            listOf(DragStart(0.1f, 0.1f), DragMove(0.15f, 0.1f)),
            r.move(150f, 200f, 20),
        )
        assertEvents(listOf(DragMove(0.2f, 0.1f)), r.move(200f, 200f, 40))
        assertEvents(listOf(DragEnd(0.2f, 0.1f)), r.up(200f, 200f, 60))
    }

    @Test
    fun `long press without movement is a right click`() {
        val r = g()
        r.down(500f, 1000f, 0)
        assertEquals(500L, r.nextDeadlineMs())
        assertTrue(r.onTimer(499).isEmpty())
        assertEvents(listOf(RightClick(0.5f, 0.5f)), r.onTimer(500))
        assertNull(r.nextDeadlineMs())
        assertTrue(r.up(500f, 1000f, 700).isEmpty())
        assertTrue(r.onTimer(900).isEmpty())
    }

    @Test
    fun `long press after moving beyond slop is a drag not a right click`() {
        val r = g()
        r.down(500f, 1000f, 0)
        r.move(540f, 1000f, 100)
        assertNull(r.nextDeadlineMs())
        assertTrue(r.onTimer(600).isEmpty())
        assertEvents(listOf(DragEnd(0.54f, 0.5f)), r.up(540f, 1000f, 700))
    }

    @Test
    fun `two fingers scroll by centroid delta and never click`() {
        val r = g()
        r.down(300f, 1000f, 0)
        assertTrue(r.onTouch(s(TouchAction.POINTER_DOWN, 10, 300f to 1000f, 700f to 1000f)).isEmpty())
        assertNull(r.nextDeadlineMs())
        assertTrue(r.onTimer(1000).isEmpty())
        // centroid (500,1000) -> (500,1200)
        assertEvents(
            listOf(Scroll(0f, 0.1f, 0.5f, 0.6f)),
            r.onTouch(s(TouchAction.MOVE, 20, 300f to 1200f, 700f to 1200f)),
        )
        assertTrue(r.onTouch(s(TouchAction.POINTER_UP, 30, 300f to 1200f)).isEmpty())
        assertTrue(r.up(300f, 1200f, 40).isEmpty())
    }

    @Test
    fun `trackpad scroll carries no position`() {
        val r = g(trackpad = true)
        r.down(300f, 1000f, 0)
        r.onTouch(s(TouchAction.POINTER_DOWN, 10, 300f to 1000f, 700f to 1000f))
        assertEvents(
            listOf(Scroll(0f, 0.1f, null, null)),
            r.onTouch(s(TouchAction.MOVE, 20, 300f to 1200f, 700f to 1200f)),
        )
    }

    @Test
    fun `second finger during a drag is ignored`() {
        val r = g()
        r.down(100f, 200f)
        r.move(200f, 200f, 20)
        assertTrue(r.onTouch(s(TouchAction.POINTER_DOWN, 30, 200f to 200f, 800f to 800f)).isEmpty())
        assertEvents(listOf(DragMove(0.3f, 0.1f)), r.move(300f, 200f, 40))
        assertEvents(listOf(DragEnd(0.3f, 0.1f)), r.up(300f, 200f, 50))
    }

    @Test
    fun `cancel during a drag ends it`() {
        val r = g()
        r.down(100f, 200f)
        r.move(200f, 400f, 20)
        assertEvents(listOf(DragEnd(0.2f, 0.2f)), r.onTouch(s(TouchAction.CANCEL, 30, 200f to 400f)))
        assertTrue(r.up(200f, 400f, 40).isEmpty())
    }

    @Test
    fun `trackpad move emits relative deltas`() {
        val r = g(trackpad = true)
        r.down(100f, 200f)
        assertTrue(r.move(105f, 200f, 10).isEmpty())
        // first post-slop sample carries the delta from the down point
        assertEvents(listOf(Move(0.05f, 0.005f)), r.move(150f, 210f, 20))
        assertEvents(listOf(Move(0.05f, 0.005f)), r.move(200f, 220f, 30))
        assertTrue(r.up(200f, 220f, 40).isEmpty())
    }

    @Test
    fun `trackpad tap clicks at the cursor`() {
        val r = g(trackpad = true)
        r.down(100f, 200f, 0)
        assertEvents(listOf(Click(null, null)), r.up(100f, 200f, 80))
        r.down(100f, 200f, 200)
        assertEvents(listOf(RightClick(null, null)), r.onTimer(700))
    }

    @Test
    fun `coordinates are normalized to the view`() {
        val r = g()
        r.down(250f, 500f)
        assertEvents(listOf(Click(0.25f, 0.25f)), r.up(250f, 500f, 10))
    }

    // Rulings where the brief is silent.

    @Test
    fun `slop is euclidean pixel distance from the down point`() {
        val within = g(); within.down(100f, 100f)
        // (6,7) is 9.22px, within slop 10 even though a Chebyshev/sum test would not agree
        assertTrue(within.move(106f, 107f, 10).isEmpty())
        val beyond = g(); beyond.down(100f, 100f)
        // (8,8) is 11.3px
        assertTrue(beyond.move(108f, 108f, 10).first() is DragStart)
    }

    @Test
    fun `outputs are clamped to the unit square`() {
        val r = g()
        r.down(100f, 200f)
        val out = r.move(1500f, -50f, 10)
        assertEvents(listOf(DragStart(0.1f, 0.1f), DragMove(1f, 0f)), out)
        assertEvents(listOf(DragEnd(1f, 0f)), r.up(1500f, -50f, 20))
    }

    @Test
    fun `scroll emits nothing for a zero delta`() {
        val r = g()
        r.down(300f, 1000f)
        r.onTouch(s(TouchAction.POINTER_DOWN, 10, 300f to 1000f, 700f to 1000f))
        assertTrue(r.onTouch(s(TouchAction.MOVE, 20, 300f to 1000f, 700f to 1000f)).isEmpty())
    }

    @Test
    fun `dropping to one finger during scroll stays in scroll without a jump or click`() {
        val r = g()
        r.down(300f, 1000f)
        r.onTouch(s(TouchAction.POINTER_DOWN, 10, 300f to 1000f, 700f to 1000f))
        // remaining pointer is at x=700; centroid would jump 200px if not re-based
        assertTrue(r.onTouch(s(TouchAction.POINTER_UP, 20, 700f to 1000f)).isEmpty())
        assertTrue(r.move(700f, 1000f, 30).isEmpty())
        assertEvents(listOf(Scroll(0f, 0.05f, 0.7f, 0.55f)), r.move(700f, 1100f, 40))
        assertNull(r.nextDeadlineMs())
        assertTrue(r.up(700f, 1100f, 50).isEmpty())
    }

    @Test
    fun `deadline exists only while a single pointer is within slop and no right click fired`() {
        val r = g()
        assertNull(r.nextDeadlineMs())
        r.down(100f, 100f, 1000)
        assertEquals(1500L, r.nextDeadlineMs())
        assertTrue(r.onTimer(1499).isEmpty())
        r.up(100f, 100f, 1100)
        assertNull(r.nextDeadlineMs())
        assertTrue(r.onTimer(2000).isEmpty())
    }

    @Test
    fun `cancel outside a drag emits nothing and resets`() {
        val r = g()
        r.down(100f, 100f)
        assertTrue(r.onTouch(s(TouchAction.CANCEL, 10, 100f to 100f)).isEmpty())
        assertNull(r.nextDeadlineMs())
        assertTrue(r.up(100f, 100f, 20).isEmpty())
        r.down(100f, 100f, 100)
        assertEvents(listOf(Click(0.1f, 0.05f)), r.up(100f, 100f, 150))
    }

    // Fix round 1.

    @Test
    fun `second finger after a right click is ignored until up`() {
        val r = g()
        r.down(500f, 1000f, 0)
        r.onTimer(500)
        assertTrue(r.onTouch(s(TouchAction.POINTER_DOWN, 600, 500f to 1000f, 700f to 1000f)).isEmpty())
        assertTrue(r.onTouch(s(TouchAction.MOVE, 610, 500f to 1100f, 700f to 1100f)).isEmpty())
        assertTrue(r.up(500f, 1100f, 700).isEmpty())
    }

    @Test
    fun `move past slop after the deadline yields a right click then nothing`() {
        val r = g()
        r.down(500f, 1000f, 0)
        assertEvents(listOf(RightClick(0.5f, 0.5f)), r.move(600f, 1000f, 600))
        assertTrue(r.move(700f, 1000f, 650).isEmpty())
        assertTrue(r.up(700f, 1000f, 700).isEmpty())
    }

    @Test
    fun `late up yields a right click not a click`() {
        val r = g()
        r.down(500f, 1000f, 0)
        assertEvents(listOf(RightClick(0.5f, 0.5f)), r.up(500f, 1000f, 800))
    }

    @Test
    fun `lifting the first finger mid-drag continues without a jump`() {
        val r = g()
        r.down(100f, 200f)
        r.move(200f, 200f, 10) // cursor at 0.2, 0.1
        r.onTouch(s(TouchAction.POINTER_DOWN, 20, 200f to 200f, 800f to 1000f))
        // finger 1 lifts; finger 2 remains elsewhere
        assertTrue(r.onTouch(s(TouchAction.POINTER_UP, 30, 800f to 1000f)).isEmpty())
        assertEvents(listOf(DragMove(0.2f, 0.1f)), r.move(800f, 1000f, 40))
        assertEvents(listOf(DragMove(0.25f, 0.1f)), r.move(850f, 1000f, 50))
        assertEvents(listOf(DragEnd(0.25f, 0.1f)), r.up(850f, 1000f, 60))
    }

    @Test
    fun `lifting a finger after trackpad moving stays in scroll without a jump`() {
        val r = g(trackpad = true)
        r.down(100f, 200f)
        r.move(200f, 200f, 10)
        r.onTouch(s(TouchAction.POINTER_DOWN, 20, 200f to 200f, 800f to 1000f))
        assertTrue(r.onTouch(s(TouchAction.POINTER_UP, 30, 800f to 1000f)).isEmpty())
        assertTrue(r.move(800f, 1000f, 40).isEmpty())
        assertEvents(listOf(Scroll(0.05f, 0f)), r.move(850f, 1000f, 50))
    }

    @Test
    fun `second finger while trackpad moving scrolls`() {
        val r = g(trackpad = true)
        r.down(300f, 1000f)
        r.move(400f, 1000f, 10)
        assertTrue(r.onTouch(s(TouchAction.POINTER_DOWN, 20, 400f to 1000f, 600f to 1000f)).isEmpty())
        assertEvents(
            listOf(Scroll(0f, 0.05f, null, null)),
            r.onTouch(s(TouchAction.MOVE, 30, 400f to 1100f, 600f to 1100f)),
        )
    }

    @Test
    fun `trackpad long press is a right click at the cursor`() {
        val r = g(trackpad = true)
        r.down(100f, 200f, 0)
        assertEvents(listOf(RightClick(null, null)), r.onTimer(500))
    }

    @Test
    fun `toggling trackpad mode mid-gesture does not change the current gesture`() {
        val r = g()
        r.down(100f, 200f)
        r.trackpadMode = true
        assertEvents(listOf(DragStart(0.1f, 0.1f), DragMove(0.2f, 0.1f)), r.move(200f, 200f, 10))
        r.up(200f, 200f, 20)
        r.down(100f, 200f, 100)
        r.trackpadMode = false
        assertEvents(listOf(Click(null, null)), r.up(100f, 200f, 150))
    }

    // Fix round 2.

    @Test
    fun `a new finger landing ahead of the remaining one during a drag does not jump`() {
        val r = g()
        r.down(100f, 200f)
        r.move(200f, 200f, 10) // cursor 0.2, 0.1
        r.onTouch(s(TouchAction.POINTER_DOWN, 20, 200f to 200f, 800f to 1000f))
        r.onTouch(s(TouchAction.POINTER_UP, 30, 800f to 1000f)) // finger 1 lifts, re-base on finger 2
        // a third finger lands and takes index 0 (at 400,400); the cursor must not jump
        assertTrue(r.onTouch(s(TouchAction.POINTER_DOWN, 40, 400f to 400f, 800f to 1000f)).isEmpty())
        assertEvents(listOf(DragMove(0.2f, 0.1f)), r.onTouch(s(TouchAction.MOVE, 50, 400f to 400f, 800f to 1000f)))
        assertEvents(listOf(DragMove(0.25f, 0.1f)), r.onTouch(s(TouchAction.MOVE, 60, 450f to 400f, 800f to 1000f)))
    }

    @Test
    fun `a down during a drag ends it first`() {
        val r = g()
        r.down(100f, 200f)
        r.move(200f, 400f, 10)
        assertEvents(listOf(DragEnd(0.2f, 0.2f)), r.down(500f, 500f, 20))
        assertEvents(listOf(Click(0.5f, 0.25f)), r.up(500f, 500f, 30))
    }

    @Test
    fun `a down with no points during a drag ends it and resets`() {
        val r = g()
        r.down(100f, 200f)
        r.move(200f, 400f, 10)
        assertEvents(listOf(DragEnd(0.2f, 0.2f)), r.onTouch(s(TouchAction.DOWN, 20)))
        assertTrue(r.up(200f, 400f, 30).isEmpty())
    }

    @Test
    fun `cancel is honoured with a zero view size`() {
        val r = g()
        r.down(100f, 200f)
        r.move(200f, 400f, 10)
        assertEvents(
            listOf(DragEnd(0.2f, 0.2f)),
            r.onTouch(TouchSample(TouchAction.CANCEL, emptyList(), 0, 0, 20)),
        )
        assertTrue(r.up(200f, 400f, 30).isEmpty())
    }
}
