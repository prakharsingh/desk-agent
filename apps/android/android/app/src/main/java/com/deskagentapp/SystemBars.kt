package com.deskagentapp

import android.os.Build
import android.view.View
import android.view.Window
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/** Kiosk-style immersive mode for the always-on display. */
object SystemBars {
  @Suppress("DEPRECATION")
  internal const val LEGACY_IMMERSIVE_FLAGS =
    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
      View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
      View.SYSTEM_UI_FLAG_FULLSCREEN or
      View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
      View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
      View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN

  fun hide(window: Window) {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    controller.hide(WindowInsetsCompat.Type.systemBars())
    controller.systemBarsBehavior =
      WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    // React Native's <Modal> copies the activity's legacy systemUiVisibility
    // onto its dialog window on SDK <= 30 (ReactModalHostView.updateSystemAppearance),
    // and the insets controller never sets those flags. Mirror them so the
    // dialog keeps the bars hidden. Newer SDKs sync through insets instead.
    if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility = LEGACY_IMMERSIVE_FLAGS
    }
  }
}
