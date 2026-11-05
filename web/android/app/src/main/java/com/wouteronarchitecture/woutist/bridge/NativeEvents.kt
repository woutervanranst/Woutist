package com.wouteronarchitecture.woutist.bridge

/** Lets background work reach the WebView app while it runs (set by [WoutistNativePlugin]). */
object NativeEvents {
    @Volatile var onChanged: (() -> Unit)? = null

    /** Graph changed from the phone (a pending operation went through): the app should sync. */
    fun changed() {
        onChanged?.invoke()
    }
}
