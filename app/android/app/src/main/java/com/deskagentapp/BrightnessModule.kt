package com.deskagentapp

import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

// Window-scoped screen brightness override (Window.attributes.screenBrightness),
// not a true system-wide Settings.System write -- no WRITE_SETTINGS permission
// needed, and it automatically stops applying once this app's window loses focus
// or is destroyed. Exactly the right scope for the Chin Light widget: force this
// app's own window bright while it's the fill-light screen, restore the prior
// value on exit, without touching the phone's actual system brightness setting
// (which would affect every other app too).
class BrightnessModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName() = "Brightness"

  @ReactMethod
  fun getBrightnessLevel(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "No current activity to read window brightness from")
      return
    }
    activity.runOnUiThread {
      val current = activity.window.attributes.screenBrightness
      if (current < 0) {
        // No window override is currently set (Window.attributes.screenBrightness
        // defaults to -1, "follow system") -- report the actual system brightness
        // (0-255) as a 0-1 fraction, so the caller gets a real, restorable value
        // rather than the -1 sentinel.
        val systemValue = Settings.System.getInt(
          reactApplicationContext.contentResolver,
          Settings.System.SCREEN_BRIGHTNESS,
          128,
        )
        promise.resolve(systemValue / 255.0)
      } else {
        promise.resolve(current.toDouble())
      }
    }
  }

  @ReactMethod
  fun setBrightnessLevel(level: Double) {
    val activity = reactApplicationContext.currentActivity ?: return
    activity.runOnUiThread {
      val layoutParams = activity.window.attributes
      layoutParams.screenBrightness = level.toFloat()
      activity.window.attributes = layoutParams
    }
  }
}
