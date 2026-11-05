package com.wouteronarchitecture.woutist

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import com.wouteronarchitecture.woutist.auth.WoutistAuthPlugin
import com.wouteronarchitecture.woutist.bridge.WoutistNativePlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // App-local plugins must be registered before the bridge starts.
        registerPlugin(WoutistAuthPlugin::class.java)
        registerPlugin(WoutistNativePlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
