package com.deskagentapp.display

import kotlin.math.hypot

sealed class SemanticEvent {
    /** null coordinates = at the cursor (trackpad). */
    data class Click(val x: Float?, val y: Float?) : SemanticEvent()
    data class RightClick(val x: Float?, val y: Float?) : SemanticEvent()
    data class DragStart(val x: Float, val y: Float) : SemanticEvent()
    data class DragMove(val x: Float, val y: Float) : SemanticEvent()
    data class DragEnd(val x: Float, val y: Float) : SemanticEvent()
    /** [x],[y]: two-finger centroid in [0,1] (absolute mode); null in trackpad mode (scroll at the cursor). */
    data class Scroll(val dx: Float, val dy: Float, val x: Float? = null, val y: Float? = null) : SemanticEvent()
    /** Trackpad only. */
    data class Move(val dx: Float, val dy: Float) : SemanticEvent()
}

enum class TouchAction { DOWN, POINTER_DOWN, MOVE, POINTER_UP, UP, CANCEL }

/**
 * [points] are in view pixels. For POINTER_UP they are the pointers that REMAIN after the lift;
 * for every other action they are all active pointers.
 */
data class TouchSample(
    val action: TouchAction,
    val points: List<Pair<Float, Float>>,
    val viewW: Int,
    val viewH: Int,
    val timeMs: Long,
)

/**
 * Pure touch-to-mouse recognizer. No Android APIs, no threads: the glue feeds samples and timer
 * ticks and forwards the returned events. Outputs are normalized to [0,1] by view size (clamped);
 * deltas are fractions of view width/height. Slop is Euclidean pixel distance from the down point.
 */
class GestureRecognizer(
    private val touchSlopPx: Float,
    private val longPressMs: Long,
    var trackpadMode: Boolean = false,
) {
    private enum class Phase { IDLE, PENDING, RIGHT_CLICKED, DRAG, MOVING, SCROLL }

    private var phase = Phase.IDLE
    private var latchedTrackpad = false
    private var downTimeMs = 0L
    private var downX = 0f
    private var downY = 0f
    private var viewW = 1
    private var viewH = 1

    /** Last normalized point (drag / trackpad move). */
    private var lastX = 0f
    private var lastY = 0f

    /** Added to the first pointer while dragging so a finger change never jumps the cursor. */
    private var dragOffX = 0f
    private var dragOffY = 0f

    /** Last centroid in normalized coords (scroll). */
    private var cenX = 0f
    private var cenY = 0f

    fun nextDeadlineMs(): Long? = if (phase == Phase.PENDING) downTimeMs + longPressMs else null

    fun onTimer(nowMs: Long): List<SemanticEvent> {
        if (phase != Phase.PENDING || nowMs < downTimeMs + longPressMs) return emptyList()
        phase = Phase.RIGHT_CLICKED
        return listOf(if (latchedTrackpad) SemanticEvent.RightClick(null, null) else SemanticEvent.RightClick(nx(downX), ny(downY)))
    }

    fun onTouch(sample: TouchSample): List<SemanticEvent> {
        // CANCEL needs no coordinates, so it is honoured even with a bad view size.
        if (sample.action == TouchAction.CANCEL) return onCancel()
        if (sample.viewW <= 0 || sample.viewH <= 0) return emptyList()
        viewW = sample.viewW
        viewH = sample.viewH
        // A late timer: the long press fires before this sample is interpreted.
        val late = if (sample.action != TouchAction.DOWN && sample.action != TouchAction.CANCEL) onTimer(sample.timeMs) else emptyList()
        return late + when (sample.action) {
            TouchAction.DOWN -> onDown(sample)
            TouchAction.POINTER_DOWN -> onPointerDown(sample)
            TouchAction.MOVE -> onMove(sample)
            TouchAction.POINTER_UP -> onPointerUp(sample)
            TouchAction.UP -> onUp(sample)
            TouchAction.CANCEL -> onCancel()
        }
    }

    private fun onDown(s: TouchSample): List<SemanticEvent> {
        // A DOWN while a drag is live ends that drag first (no orphan DragStart).
        val end = if (phase == Phase.DRAG) listOf<SemanticEvent>(SemanticEvent.DragEnd(lastX, lastY)) else emptyList()
        val p = s.points.firstOrNull()
        if (p == null) {
            reset()
            return end
        }
        phase = Phase.PENDING
        latchedTrackpad = trackpadMode
        downTimeMs = s.timeMs
        downX = p.first
        downY = p.second
        lastX = nx(downX)
        lastY = ny(downY)
        return end
    }

    private fun onPointerDown(s: TouchSample): List<SemanticEvent> {
        when (phase) {
            Phase.IDLE, Phase.RIGHT_CLICKED -> {}
            Phase.DRAG -> rebaseDrag(s.points.firstOrNull())
            Phase.SCROLL -> rebase(s)
            else -> {
                phase = Phase.SCROLL
                rebase(s)
            }
        }
        return emptyList()
    }

    private fun onPointerUp(s: TouchSample): List<SemanticEvent> {
        val p = s.points.firstOrNull()
        when (phase) {
            Phase.SCROLL -> rebase(s)
            Phase.DRAG -> rebaseDrag(p)
            Phase.MOVING -> if (p != null) {
                lastX = nx(p.first)
                lastY = ny(p.second)
            }
            else -> {}
        }
        return emptyList()
    }

    private fun onMove(s: TouchSample): List<SemanticEvent> {
        val p = s.points.firstOrNull() ?: return emptyList()
        when (phase) {
            Phase.PENDING -> {
                if (hypot(p.first - downX, p.second - downY) <= touchSlopPx) return emptyList()
                return if (latchedTrackpad) {
                    phase = Phase.MOVING
                    val out = moveEvent(nx(p.first) - nx(downX), ny(p.second) - ny(downY))
                    lastX = nx(p.first)
                    lastY = ny(p.second)
                    out
                } else {
                    phase = Phase.DRAG
                    dragOffX = 0f
                    dragOffY = 0f
                    lastX = nx(p.first)
                    lastY = ny(p.second)
                    listOf(
                        SemanticEvent.DragStart(nx(downX), ny(downY)),
                        SemanticEvent.DragMove(lastX, lastY),
                    )
                }
            }
            Phase.DRAG -> {
                lastX = (nx(p.first) + dragOffX).coerceIn(0f, 1f)
                lastY = (ny(p.second) + dragOffY).coerceIn(0f, 1f)
                return listOf(SemanticEvent.DragMove(lastX, lastY))
            }
            Phase.MOVING -> {
                val x = nx(p.first)
                val y = ny(p.second)
                val out = moveEvent(x - lastX, y - lastY)
                lastX = x
                lastY = y
                return out
            }
            Phase.SCROLL -> {
                val (cx, cy) = centroid(s) ?: return emptyList()
                val out = scrollEvent(cx - cenX, cy - cenY, cx, cy)
                cenX = cx
                cenY = cy
                return out
            }
            Phase.IDLE, Phase.RIGHT_CLICKED -> return emptyList()
        }
    }

    private fun onUp(s: TouchSample): List<SemanticEvent> {
        val out: List<SemanticEvent> = when (phase) {
            Phase.PENDING ->
                listOf(if (latchedTrackpad) SemanticEvent.Click(null, null) else SemanticEvent.Click(nx(downX), ny(downY)))
            Phase.DRAG -> {
                val p = s.points.firstOrNull()
                val x = if (p != null) (nx(p.first) + dragOffX).coerceIn(0f, 1f) else lastX
                val y = if (p != null) (ny(p.second) + dragOffY).coerceIn(0f, 1f) else lastY
                listOf(SemanticEvent.DragEnd(x, y))
            }
            else -> emptyList()
        }
        reset()
        return out
    }

    private fun onCancel(): List<SemanticEvent> {
        val out = if (phase == Phase.DRAG) listOf(SemanticEvent.DragEnd(lastX, lastY)) else emptyList()
        reset()
        return out
    }

    private fun reset(): List<SemanticEvent> {
        phase = Phase.IDLE
        return emptyList()
    }

    private fun rebaseDrag(p: Pair<Float, Float>?) {
        if (p == null) return
        dragOffX = lastX - nx(p.first)
        dragOffY = lastY - ny(p.second)
    }

    private fun rebase(s: TouchSample) {
        centroid(s)?.let { (cx, cy) -> cenX = cx; cenY = cy }
    }

    private fun centroid(s: TouchSample): Pair<Float, Float>? {
        if (s.points.isEmpty()) return null
        val x = s.points.sumOf { it.first.toDouble() } / s.points.size
        val y = s.points.sumOf { it.second.toDouble() } / s.points.size
        return nx(x.toFloat()) to ny(y.toFloat())
    }

    private fun moveEvent(dx: Float, dy: Float): List<SemanticEvent> =
        if (dx == 0f && dy == 0f) emptyList() else listOf(SemanticEvent.Move(dx, dy))

    private fun scrollEvent(dx: Float, dy: Float, cx: Float, cy: Float): List<SemanticEvent> =
        if (dx == 0f && dy == 0f) emptyList()
        else if (latchedTrackpad) listOf(SemanticEvent.Scroll(dx, dy))
        else listOf(SemanticEvent.Scroll(dx, dy, cx.coerceIn(0f, 1f), cy.coerceIn(0f, 1f)))

    private fun nx(x: Float) = (x / viewW).coerceIn(0f, 1f)
    private fun ny(y: Float) = (y / viewH).coerceIn(0f, 1f)
}
