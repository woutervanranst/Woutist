package com.wouteronarchitecture.woutist

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.wouteronarchitecture.woutist.work.RefreshWorker

/**
 * Debug builds only: `adb shell am broadcast -a com.wouteronarchitecture.woutist.DEBUG_REFRESH
 * -p com.wouteronarchitecture.woutist.debug` runs a background refresh now (WorkManager won't run
 * periodic work early).
 */
class DebugRefreshReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        RefreshWorker.refreshSoon(context)
    }
}
