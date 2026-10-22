package com.deskagentapp.display

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * JS surface of the phone extended display (`NativeModules.DisplayModule`).
 * Events (`DeviceEventEmitter`): `DisplayState` `{ state, reason?, inputEnabled? }` and
 * `DisplaySurfaceSize` `{ w, h, orientation, dpi }`.
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
        session.input(SessionInput.Start(sessionId, videoPort.toInt(), session.nowMs()))
        if (token != null) session.input(SessionInput.TokenAvailable(sessionId, token))
    }

    @ReactMethod
    fun stop() = session.input(SessionInput.UserStop)

    /** JS has subscribed: re-emit the surface size if the surface already reported it. */
    @ReactMethod
    fun requestSize() = session.requestSize()

    /** No-op until trackpad mode lands (Task 4.4). */
    @ReactMethod
    @Suppress("UNUSED_PARAMETER")
    fun setTrackpadMode(enabled: Boolean) = Unit

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
        super.invalidate()
    }

    companion object {
        const val NAME = "DisplayModule"

        fun stateEventMap(e: SessionAction.Emit): Map<String, Any?> = buildMap {
            put("state", e.state)
            e.reason?.let { put("reason", it) }
            e.inputEnabled?.let { put("inputEnabled", it) }
        }

        fun sizeEventMap(w: Int, h: Int, dpi: Float): Map<String, Any?> = mapOf(
            "w" to w,
            "h" to h,
            "orientation" to orientationOf(w, h),
            "dpi" to dpi.toDouble(),
        )
    }
}
