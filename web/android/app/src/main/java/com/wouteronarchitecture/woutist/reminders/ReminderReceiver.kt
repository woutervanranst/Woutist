package com.wouteronarchitecture.woutist.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.wouteronarchitecture.woutist.data.Snapshot
import com.wouteronarchitecture.woutist.data.SnapshotStore

/** Notify only for tasks that are still open in the latest snapshot (not completed, deleted or moved since). */
fun shouldNotify(s: Snapshot?, taskId: String): Boolean = s?.tasks?.any { it.id == taskId } == true

/** A reminder alarm went off. */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_FIRE) return
        val taskId = intent.getStringExtra(EXTRA_TASK_ID) ?: return
        val current = SnapshotStore.get(context).current()
        if (!shouldNotify(current, taskId)) return
        val task = current!!.tasks.first { it.id == taskId }
        val listName = current.lists.firstOrNull { it.id == task.listId }?.name.orEmpty()
        Notifications.showReminder(context, task, listName)
    }

    companion object {
        const val ACTION_FIRE = "com.wouteronarchitecture.woutist.REMINDER"
        const val EXTRA_TASK_ID = "taskId"
        const val EXTRA_LIST_ID = "listId"
    }
}
