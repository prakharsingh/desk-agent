package com.deskagentapp.display

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

/** `<DeskAgentDisplayView />`: prop-free host for the decoder's SurfaceView (legacy view-manager interop). */
class DisplayViewManager : SimpleViewManager<DisplaySurfaceView>() {
    override fun getName() = NAME

    override fun createViewInstance(reactContext: ThemedReactContext) = DisplaySurfaceView(reactContext)

    companion object {
        const val NAME = "DeskAgentDisplayView"
    }
}
