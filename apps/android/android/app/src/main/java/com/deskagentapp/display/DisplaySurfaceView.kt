package com.deskagentapp.display

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Rect
import android.os.Build
import android.os.SystemClock
import android.util.Log
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewConfiguration
import com.facebook.react.uimanager.events.NativeGestureUtil

/**
 * Converts one [MotionEvent] for [GestureRecognizer]. `points` are in view pixels; for
 * ACTION_POINTER_UP they exclude the lifting pointer (`actionIndex`), as the recognizer requires;
 * ACTION_UP carries the lifting pointer's last position. `timeMs` is `eventTime`, i.e. the
 * [SystemClock.uptimeMillis] base. Other actions (hover, outside, ...) return null.
 */
fun touchSampleOf(ev: MotionEvent, viewW: Int, viewH: Int): TouchSample? {
    val action = when (ev.actionMasked) {
        MotionEvent.ACTION_DOWN -> TouchAction.DOWN
        MotionEvent.ACTION_POINTER_DOWN -> TouchAction.POINTER_DOWN
        MotionEvent.ACTION_MOVE -> TouchAction.MOVE
        MotionEvent.ACTION_POINTER_UP -> TouchAction.POINTER_UP
        MotionEvent.ACTION_UP -> TouchAction.UP
        MotionEvent.ACTION_CANCEL -> TouchAction.CANCEL
        else -> return null
    }
    val skip = if (action == TouchAction.POINTER_UP) ev.actionIndex else -1
    val points = (0 until ev.pointerCount).filter { it != skip }.map { ev.getX(it) to ev.getY(it) }
    return TouchSample(action, points, viewW, viewH, ev.eventTime)
}

/** The long-press timer's main-thread scheduler (the view's Handler in production). */
interface TouchTimer {
    fun schedule(r: Runnable, delayMs: Long)
    fun cancel(r: Runnable)
}

/**
 * Glue between touch samples, the recognizer's long-press timer and the event sink. Every call
 * must happen on one thread (the UI thread): the recognizer is not thread-safe. At most one timer
 * runnable is pending; it is cancelled on every sample and rescheduled at `nextDeadlineMs()`,
 * measured with [clock] (must share MotionEvent.eventTime's uptimeMillis base).
 */
class DisplayTouchController(
    private val recognizer: GestureRecognizer,
    private val timer: TouchTimer,
    private val clock: () -> Long,
    private val sink: (SemanticEvent) -> Unit,
) {
    private val timeout = Runnable { onTimeout() }
    private var lastW = 1
    private var lastH = 1

    var trackpadMode: Boolean
        get() = recognizer.trackpadMode
        set(value) { recognizer.trackpadMode = value } // latched by the recognizer at the next DOWN

    fun onSample(s: TouchSample) {
        if (s.viewW > 0 && s.viewH > 0) { lastW = s.viewW; lastH = s.viewH }
        forward(recognizer.onTouch(s))
        reschedule()
    }

    /** Ends any gesture in progress (a drag yields DragEnd) and drops the timer. Idempotent. */
    fun cancel() = onSample(TouchSample(TouchAction.CANCEL, emptyList(), lastW, lastH, clock()))

    private fun onTimeout() {
        forward(recognizer.onTimer(clock()))
        reschedule()
    }

    private fun reschedule() {
        timer.cancel(timeout)
        val deadline = recognizer.nextDeadlineMs() ?: return
        timer.schedule(timeout, (deadline - clock()).coerceAtLeast(0L))
    }

    private fun forward(events: List<SemanticEvent>) = events.forEach(sink)
}

/**
 * The decoder's output surface and the touch source. No background is drawn (a view background
 * would cover the video); until the first frame the SurfaceView's own black background layer shows.
 * Surface callbacks and touches run on the main thread; surface events go to [DisplaySession],
 * recognized gestures to [DisplaySession.sendInput] (dropped there unless streaming with input on).
 */
class DisplaySurfaceView(context: Context) : SurfaceView(context), SurfaceHolder.Callback {
    private val touch = DisplayTouchController(
        GestureRecognizer(
            touchSlopPx = ViewConfiguration.get(context).scaledTouchSlop.toFloat(),
            longPressMs = ViewConfiguration.getLongPressTimeout().toLong(),
        ),
        object : TouchTimer {
            override fun schedule(r: Runnable, delayMs: Long) { postDelayed(r, delayMs) }
            override fun cancel(r: Runnable) { removeCallbacks(r) }
        },
        clock = { SystemClock.uptimeMillis() },
        sink = { DisplaySession.sendInput(it) },
    )

    init {
        holder.addCallback(this)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        DisplaySession.attachView(this)
        applyTrackpadMode()
    }

    override fun onDetachedFromWindow() {
        touch.cancel()
        DisplaySession.detachView(this)
        // Attaching punched a hole in the window's transparent region (requested through a root
        // layout). Detaching does not reach ViewRootImpl: RN's ViewGroups swallow requestLayout and
        // Fabric lays children out directly, so the stale hole hid whatever replaced this view
        // (a black screen with only a strip showing). One root relayout recomputes the region.
        val root = rootView
        super.onDetachedFromWindow()
        if (root !== this) root.post { root.requestLayout() }
    }

    /** Main thread. */
    fun applyTrackpadMode() {
        touch.trackpadMode = DisplaySession.trackpadMode
    }

    /** Main thread: the session ended or the surface went away mid-gesture. */
    fun cancelGesture() = touch.cancel()

    @SuppressLint("ClickableViewAccessibility") // a pointer surface, not a clickable control
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            // JS stops tracking this touch (no RN responder fires under the display).
            MotionEvent.ACTION_DOWN -> NativeGestureUtil.notifyNativeGestureStarted(this, event)
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> NativeGestureUtil.notifyNativeGestureEnded(this, event)
        }
        touchSampleOf(event, width, height)?.let { touch.onSample(it) }
        return true
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Keep edge swipes for the Mac where Android allows it; it caps the honored height
            // (partial mitigation by design).
            val strip = (EDGE_EXCLUSION_DP * resources.displayMetrics.density).toInt()
            val w = right - left
            val h = bottom - top
            systemGestureExclusionRects = listOf(Rect(0, 0, strip, h), Rect(w - strip, 0, w, h))
        }
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        Log.i(TAG, "surfaceCreated")
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        Log.i(TAG, "surfaceChanged ${width}x$height")
        DisplaySession.surfaceReady(holder.surface, width, height)
        DisplaySession.emitSize(width, height, resources.displayMetrics.xdpi)
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        Log.i(TAG, "surfaceDestroyed")
        touch.cancel()
        DisplaySession.surfaceLost()
    }

    private companion object {
        const val TAG = "DeskAgentDisplay"
        const val EDGE_EXCLUSION_DP = 24
    }
}
