package com.deskagentapp.display

import android.content.pm.ActivityInfo
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * JS surface of the phone extended display (`NativeModules.DisplayModule`).
 * Events (`DeviceEventEmitter`): `DisplayState` `{ state, reason?, inputEnabled? }`,
 * `DisplaySurfaceSize` `{ w, h, orientation, dpi }` and `DisplayStreamSize` `{ w, h, orientation }` (each
 * helper `streamConfig`: the size the Mac now streams).
 * All work is queued onto the display-session thread; nothing here blocks the JS thread.
 */
class DisplayModule(
    reactContext: ReactApplicationContext,
    private val session: DisplaySessionHost = DisplaySession,
) : ReactContextBaseJavaModule(reactContext) {

    init {
        session.setEvents(object : DisplayEvents {
            override fun emit(name: String, body: Map<String, Any?>) {
                try {
                    reactApplicationContext.emitDeviceEvent(name, Arguments.makeNativeMap(body))
                } catch (e: Exception) { // no active instance (reload/teardown)
                    Log.w(DisplaySessionRunner.TAG, "$name not delivered: ${e.message}")
                }
            }
        })
        // Tokens that arrive after start(): the session takes them only for the awaited session.
        DisplayTokenHolder.setListener { sessionId -> session.tokenOffered(sessionId) }
    }

    override fun getName() = NAME

    @ReactMethod
    fun start(sessionId: String, videoPort: Double) {
        // The intent can beat the JSON reply: take a token that is already here, right away.
        val token = DisplayTokenHolder.take(sessionId)
        // Every session starts with trackpad mode off (hello carries it); JS mirrors this.
        session.setTrackpadMode(false)
        session.input(SessionInput.Start(sessionId, videoPort.toInt(), session.nowMs()))
        if (token != null) session.input(SessionInput.TokenAvailable(sessionId, token))
    }

    @ReactMethod
    fun stop() = session.input(SessionInput.UserStop)

    /** JS has subscribed: re-emit the surface size if the surface already reported it. */
    @ReactMethod
    fun requestSize() = session.requestSize()

    /** Recognizer change on the view's main thread; `setTrackpad` to the helper via the session thread. */
    @ReactMethod
    fun setTrackpadMode(enabled: Boolean) = session.setTrackpadMode(enabled)

    /**
     * The rotate control: `portrait` / `landscape` pin the activity's requested orientation (a docked or flat
     * phone never auto-rotates), `unspecified` hands it back to the sensor and the user's auto-rotate setting.
     * The surface then reports its new size and the session renegotiates as for a physical rotation.
     */
    @ReactMethod
    fun setOrientation(mode: String) {
        val requested = requestedOrientationFor(mode) ?: run {
            Log.w(DisplaySessionRunner.TAG, "unknown orientation $mode")
            return
        }
        val activity = reactApplicationContext.currentActivity ?: run {
            // A destroyed activity takes its lock with it, but a dropped request must leave a trace.
            Log.w(DisplaySessionRunner.TAG, "setOrientation($mode) dropped: no activity")
            return
        }
        activity.runOnUiThread { activity.requestedOrientation = requested }
    }

    // Required by NativeEventEmitter; events go through emitDeviceEvent regardless.
    @ReactMethod
    @Suppress("UNUSED_PARAMETER")
    fun addListener(eventName: String) = Unit

    @ReactMethod
    @Suppress("UNUSED_PARAMETER")
    fun removeListeners(count: Double) = Unit

    /** RN teardown (reload): JS loses the session, so end it rather than leave the Mac streaming. */
    override fun invalidate() {
        session.input(SessionInput.UserStop)
        setOrientation("unspecified") // a reload must not leave a rotate-control lock behind
        super.invalidate()
    }

    companion object {
        const val NAME = "DisplayModule"

        fun stateEventMap(e: SessionAction.Emit): Map<String, Any?> = buildMap {
            put("state", e.state)
            e.reason?.let { put("reason", it) }
            e.inputEnabled?.let { put("inputEnabled", it) }
        }

        fun requestedOrientationFor(mode: String): Int? = when (mode) {
            "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            "landscape" -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            "unspecified" -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            else -> null
        }

        fun sizeEventMap(w: Int, h: Int, dpi: Float): Map<String, Any?> = mapOf(
            "w" to w,
            "h" to h,
            "orientation" to orientationOf(w, h),
            "dpi" to dpi.toDouble(),
        )
    }
}
