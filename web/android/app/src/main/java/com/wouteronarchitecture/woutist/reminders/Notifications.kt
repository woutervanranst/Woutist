package com.wouteronarchitecture.woutist.reminders

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.wouteronarchitecture.woutist.MainActivity
import com.wouteronarchitecture.woutist.R
import com.wouteronarchitecture.woutist.data.SnapTask

object Notifications {
    const val CHANNEL = "reminders"
    /** Intent extra carrying the in-app path MainActivity should open (`/lists/<listId>?task=<taskId>`). */
    const val EXTRA_URL = "com.wouteronarchitecture.woutist.URL"

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) != null) return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.channel_reminders), NotificationManager.IMPORTANCE_HIGH)
                .apply { description = context.getString(R.string.channel_reminders_description) },
        )
    }

    fun notificationId(taskId: String) = taskId.hashCode()

    fun taskPath(listId: String, taskId: String) = "/lists/${Uri.encode(listId)}?task=${Uri.encode(taskId)}"

    @SuppressLint("MissingPermission") // checked through areNotificationsEnabled()
    fun showReminder(context: Context, task: SnapTask, listName: String) {
        val nm = NotificationManagerCompat.from(context)
        if (!nm.areNotificationsEnabled()) return
        ensureChannel(context)
        val id = notificationId(task.id)
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_woutist)
            .setColor(ContextCompat.getColor(context, R.color.woutist_brand))
            .setContentTitle(task.title)
            .setContentText(listName)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openTaskIntent(context, task.listId, task.id))
            .addAction(0, context.getString(R.string.action_complete), actionIntent(context, NotificationActionReceiver.ACTION_COMPLETE, task))
            .addAction(0, context.getString(R.string.action_snooze), actionIntent(context, NotificationActionReceiver.ACTION_SNOOZE, task))
            .build()
        nm.notify(id, notification)
    }

    /** Opens the app at the task (notification tap, or the alarm in the system's "next alarm"). */
    fun openTaskIntent(context: Context, listId: String, taskId: String): PendingIntent {
        val open = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_URL, taskPath(listId, taskId))
        return PendingIntent.getActivity(context, notificationId(taskId), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun cancel(context: Context, taskId: String) = NotificationManagerCompat.from(context).cancel(notificationId(taskId))

    private fun actionIntent(context: Context, action: String, task: SnapTask): PendingIntent {
        val intent = Intent(context, NotificationActionReceiver::class.java)
            .setAction(action)
            .setData(Uri.parse("woutist://task/" + Uri.encode(task.id)))
            .putExtra(ReminderReceiver.EXTRA_TASK_ID, task.id)
            .putExtra(ReminderReceiver.EXTRA_LIST_ID, task.listId)
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
}
