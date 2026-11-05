package com.wouteronarchitecture.woutist.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.wouteronarchitecture.woutist.data.Snapshot
import com.wouteronarchitecture.woutist.data.SnapshotStore
import java.time.Instant

/**
 * Notify only for tasks still open in the latest snapshot (not completed, deleted or moved since),
 * and, for a reminder alarm armed for [fireAt], only while the task's reminder is still that time
 * (not turned off or moved). Snoozes pass null.
 */
fun shouldNotify(s: Snapshot?, taskId: String, fireAt: String? = null): Boolean {
    val task = s?.tasks?.firstOrNull { it.id == taskId } ?: return false
    if (fireAt == null) return true
    return task.reminderAt != null && Instant.parse(task.reminderAt) == Instant.parse(fireAt)
}

/** A reminder alarm went off. */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_FIRE) return
        val taskId = intent.getStringExtra(EXTRA_TASK_ID) ?: return
        val key = intent.getStringExtra(EXTRA_KEY) ?: taskId
        val fireAt = intent.getStringExtra(EXTRA_FIRE_AT)
        // Already shown (as a missed reminder after a reboot): don't notify twice.
        if (fireAt != null && !ReminderScheduler.markFired(context, key, Instant.parse(fireAt))) return
        val current = SnapshotStore.get(context).current()
        if (!shouldNotify(current, taskId, if (key == taskId) fireAt else null)) return
        Notifications.showReminder(context, current!!, taskId)
    }

    companion object {
        const val ACTION_FIRE = "com.wouteronarchitecture.woutist.REMINDER"
        const val EXTRA_TASK_ID = "taskId"
        const val EXTRA_LIST_ID = "listId"
        const val EXTRA_KEY = "key"
        const val EXTRA_FIRE_AT = "fireAt"
    }
}
