package com.wouteronarchitecture.woutist.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.wouteronarchitecture.woutist.data.PendingOp
import com.wouteronarchitecture.woutist.data.SnapshotStore
import com.wouteronarchitecture.woutist.work.TaskOpWorker
import java.util.UUID

/** Complete and Snooze on a reminder notification. */
class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val taskId = intent.getStringExtra(ReminderReceiver.EXTRA_TASK_ID) ?: return
        val listId = intent.getStringExtra(ReminderReceiver.EXTRA_LIST_ID) ?: return
        when (intent.action) {
            ACTION_COMPLETE -> {
                val op = PendingOp.Complete(UUID.randomUUID().toString(), listId, taskId)
                SnapshotStore.get(context).addPending(op)
                TaskOpWorker.enqueue(context, op.id)
            }
            ACTION_SNOOZE -> ReminderScheduler.snooze(context, taskId, listId)
            else -> return
        }
        Notifications.cancel(context, taskId)
    }

    companion object {
        const val ACTION_COMPLETE = "com.wouteronarchitecture.woutist.COMPLETE"
        const val ACTION_SNOOZE = "com.wouteronarchitecture.woutist.SNOOZE"
    }
}
