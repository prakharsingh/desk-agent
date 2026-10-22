package com.deskagentapp.display

import android.view.MotionEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Records scheduled runnables like a main-thread Handler, without running them. */
private class FakeTimer : TouchTimer {
    val pending = mutableListOf<Pair<Runnable, Long>>()
    var schedules = 0
    override fun schedule(r: Runnable, delayMs: Long) { schedules++; pending += r to delayMs }
    override fun cancel(r: Runnable) { pending.removeAll { it.first === r } }
    fun fire() {
        val (r, _) = pending.removeAt(0)
        r.run()
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DisplayTouchTest {
    private val now = longArrayOf(10_000)
    private val timer = FakeTimer()
    private val sent = mutableListOf<SemanticEvent>()
    private val controller = DisplayTouchController(
        GestureRecognizer(touchSlopPx = 10f, longPressMs = 500),
        timer,
        clock = { now[0] },
        sink = { sent += it },
    )

    private fun motion(action: Int, t: Long, vararg pts: Pair<Float, Float>): MotionEvent {
        val props = Array(pts.size) { i -> MotionEvent.PointerProperties().apply { id = i; toolType = MotionEvent.TOOL_TYPE_FINGER } }
        val coords = Array(pts.size) { i -> MotionEvent.PointerCoords().apply { x = pts[i].first; y = pts[i].second; pressure = 1f; size = 1f } }
        return MotionEvent.obtain(t - 5, t, action, pts.size, props, coords, 0, 0, 1f, 1f, 0, 0, 0, 0)
    }

    private fun pointerAction(base: Int, index: Int) = base or (index shl MotionEvent.ACTION_POINTER_INDEX_SHIFT)

    private fun sample(a: TouchAction, t: Long, vararg pts: Pair<Float, Float>) = TouchSample(a, pts.toList(), 1000, 500, t)

    // ---- MotionEvent -> TouchSample ----

    @Test fun `pointer up excludes the lifting pointer and keeps the rest in order`() {
        val ev = motion(pointerAction(MotionEvent.ACTION_POINTER_UP, 1), 42, 10f to 20f, 30f to 40f, 50f to 60f)
        val s = touchSampleOf(ev, 1000, 500)!!
        assertEquals(TouchAction.POINTER_UP, s.action)
        assertEquals(listOf(10f to 20f, 50f to 60f), s.points)
        assertEquals(42L, s.timeMs)
        assertEquals(1000, s.viewW); assertEquals(500, s.viewH)
        ev.recycle()
    }

    @Test fun `pointer up of the first pointer leaves the second`() {
        val ev = motion(pointerAction(MotionEvent.ACTION_POINTER_UP, 0), 7, 10f to 20f, 30f to 40f)
        assertEquals(listOf(30f to 40f), touchSampleOf(ev, 1000, 500)!!.points)
        ev.recycle()
    }

    @Test fun `up carries the lifting pointer's last position`() {
        val ev = motion(MotionEvent.ACTION_UP, 9, 70f to 80f)
        val s = touchSampleOf(ev, 1000, 500)!!
        assertEquals(TouchAction.UP, s.action)
        assertEquals(listOf(70f to 80f), s.points)
        ev.recycle()
    }

    @Test fun `down pointer-down move and cancel carry every pointer`() {
        val d = motion(MotionEvent.ACTION_DOWN, 1, 1f to 2f)
        assertEquals(TouchAction.DOWN, touchSampleOf(d, 10, 10)!!.action)
        val pd = motion(pointerAction(MotionEvent.ACTION_POINTER_DOWN, 1), 2, 1f to 2f, 3f to 4f)
        val pds = touchSampleOf(pd, 10, 10)!!
        assertEquals(TouchAction.POINTER_DOWN, pds.action); assertEquals(listOf(1f to 2f, 3f to 4f), pds.points)
        val m = motion(MotionEvent.ACTION_MOVE, 3, 5f to 6f, 7f to 8f)
        assertEquals(listOf(5f to 6f, 7f to 8f), touchSampleOf(m, 10, 10)!!.points)
        val c = motion(MotionEvent.ACTION_CANCEL, 4, 5f to 6f)
        assertEquals(TouchAction.CANCEL, touchSampleOf(c, 10, 10)!!.action)
        listOf(d, pd, m, c).forEach { it.recycle() }
    }

    @Test fun `other actions are ignored`() {
        val ev = motion(MotionEvent.ACTION_OUTSIDE, 1, 1f to 2f)
        assertNull(touchSampleOf(ev, 10, 10))
        ev.recycle()
    }

    // ---- controller: long-press timer, forwarding, cancel ----

    @Test fun `down schedules one long-press timer at the deadline`() {
        controller.onSample(sample(TouchAction.DOWN, 10_000, 100f to 100f))
        assertEquals(1, timer.pending.size)
        assertEquals(500L, timer.pending.single().second)
    }

    @Test fun `every new sample cancels and reschedules so only one timer is pending`() {
        controller.onSample(sample(TouchAction.DOWN, 10_000, 100f to 100f))
        now[0] = 10_200
        controller.onSample(sample(TouchAction.MOVE, 10_200, 102f to 101f)) // within slop
        assertEquals(1, timer.pending.size)
        assertEquals(300L, timer.pending.single().second) // measured from the same clock
    }

    @Test fun `the timer fires a right click at the down point`() {
        controller.onSample(sample(TouchAction.DOWN, 10_000, 500f to 250f))
        now[0] = 10_500
        timer.fire()
        assertEquals(listOf<SemanticEvent>(SemanticEvent.RightClick(0.5f, 0.5f)), sent)
        assertTrue(timer.pending.isEmpty())
    }

    @Test fun `an early timer tick reschedules for the remainder`() {
        controller.onSample(sample(TouchAction.DOWN, 10_000, 500f to 250f))
        now[0] = 10_400
        timer.fire()
        assertTrue(sent.isEmpty())
        assertEquals(100L, timer.pending.single().second)
    }

    @Test fun `leaving pending clears the timer`() {
        controller.onSample(sample(TouchAction.DOWN, 10_000, 100f to 100f))
        controller.onSample(sample(TouchAction.MOVE, 10_050, 200f to 100f)) // past slop -> drag
        assertTrue(timer.pending.isEmpty())
        assertEquals(SemanticEvent.DragStart(0.1f, 0.2f), sent.first())
    }

    @Test fun `cancel mid-drag ends the drag and clears the timer`() {
        controller.onSample(sample(TouchAction.DOWN, 10_000, 100f to 100f))
        controller.onSample(sample(TouchAction.MOVE, 10_050, 200f to 100f))
        sent.clear()
        controller.cancel()
        assertEquals(listOf<SemanticEvent>(SemanticEvent.DragEnd(0.2f, 0.2f)), sent)
        assertTrue(timer.pending.isEmpty())
        controller.cancel() // idempotent
        assertEquals(1, sent.size)
    }

    @Test fun `cancel while pending drops the long press timer`() {
        controller.onSample(sample(TouchAction.DOWN, 10_000, 100f to 100f))
        controller.cancel()
        assertTrue(timer.pending.isEmpty())
        assertTrue(sent.isEmpty())
    }

    @Test fun `trackpad mode reaches the recognizer`() {
        controller.trackpadMode = true
        controller.onSample(sample(TouchAction.DOWN, 10_000, 100f to 100f))
        controller.onSample(sample(TouchAction.UP, 10_050, 100f to 100f))
        assertEquals(listOf<SemanticEvent>(SemanticEvent.Click(null, null)), sent)
    }
}
