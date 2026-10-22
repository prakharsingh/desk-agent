package com.deskagentapp.display

import android.content.Context
import android.util.Log
import android.view.SurfaceHolder
import android.view.SurfaceView

/**
 * The decoder's output surface. No background is drawn (a view background would cover the
 * video); until the first frame the SurfaceView's own black background layer shows.
 * Surface callbacks run on the main thread and are forwarded to [DisplaySession].
 */
class DisplaySurfaceView(context: Context) : SurfaceView(context), SurfaceHolder.Callback {
    init {
        holder.addCallback(this)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        DisplaySession.attachView(this)
    }

    override fun onDetachedFromWindow() {
        DisplaySession.detachView(this)
        // Attaching punched a hole in the window's transparent region (requested through a root
        // layout). Detaching does not reach ViewRootImpl: RN's ViewGroups swallow requestLayout and
        // Fabric lays children out directly, so the stale hole hid whatever replaced this view
        // (a black screen with only a strip showing). One root relayout recomputes the region.
        val root = rootView
        super.onDetachedFromWindow()
        if (root !== this) root.post { root.requestLayout() }
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
        DisplaySession.surfaceLost()
    }

    private companion object {
        const val TAG = "DeskAgentDisplay"
    }
}
