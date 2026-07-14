package com.deskagentapp

import android.content.Intent
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class PresenceServiceModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName() = "PresenceService"

  @ReactMethod
  fun start() {
    val intent = Intent(reactApplicationContext, PresenceForegroundService::class.java)
    reactApplicationContext.startForegroundService(intent)
  }

  @ReactMethod
  fun stop() {
    reactApplicationContext.stopService(Intent(reactApplicationContext, PresenceForegroundService::class.java))
  }
}
