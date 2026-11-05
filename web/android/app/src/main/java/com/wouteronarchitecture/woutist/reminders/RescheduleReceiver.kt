package com.wouteronarchitecture.woutist.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.wouteronarchitecture.woutist.data.SnapshotStore

/** Re-arms every reminder after a reboot, an app update, a time-zone change or an exact-alarm permission change. */
class RescheduleReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in ACTIONS) return
        ReminderScheduler.reschedule(context, SnapshotStore.get(context), force = true)
    }

    companion object {
        private val ACTIONS = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIMEZONE_CHANGED,
            "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED",
        )
    }
}
