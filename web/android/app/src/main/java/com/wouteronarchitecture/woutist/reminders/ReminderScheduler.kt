package com.wouteronarchitecture.woutist.reminders

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import com.wouteronarchitecture.woutist.data.Snapshot
import com.wouteronarchitecture.woutist.data.SnapshotStore
import org.json.JSONObject
import java.time.Duration
import java.time.Instant

/** Keeps the phone's alarms equal to the reminders of the current snapshot (plus local snoozes). */
object ReminderScheduler {
    private const val PREFS = "woutist.reminders"
    private const val ARMED = "armed"
    private const val SNOOZES = "snoozes"
    val SNOOZE: Duration = Duration.ofMinutes(10)

    /** Alarms survive neither a reboot nor a force-stop; the first sync in a process re-arms everything. */
    @Volatile private var trustedThisProcess = false

    fun snoozeKey(taskId: String) = "snooze:$taskId"

    /** Alarms to cancel (keys no longer wanted) and reminders to (re-)arm (new or moved). */
    fun diff(old: Map<String, Instant>, new: List<Reminder>): Pair<List<String>, List<Reminder>> {
        val keys = new.map { it.key }.toSet()
        return old.keys.filter { it !in keys } to new.filter { old[it.key] != it.fireAt }
    }

    /**
     * [diff], or with [force] (the armed record can't be trusted): re-arm every reminder still ahead.
     * Reminders inside the grace window already fired; arming them again would notify twice.
     */
    fun plan(armed: Map<String, Instant>, desired: List<Reminder>, now: Instant, force: Boolean): Pair<List<String>, List<Reminder>> {
        val (cancel, set) = diff(armed, desired)
        return if (force) cancel to desired.filter { it.fireAt > now } else cancel to set
    }

    fun reschedule(context: Context, store: SnapshotStore, force: Boolean = false) = synchronized(this) {
        val now = Instant.now()
        val current = store.current()
        val desired = (current?.let { ReminderRules.desired(it, now) } ?: emptyList()) + snoozes(context, current, now)
        val (cancel, set) = plan(readArmed(context), desired, now, force || !trustedThisProcess)
        cancel.forEach { cancelAlarm(context, it) }
        set.forEach { arm(context, it) }
        writeArmed(context, desired.associate { it.key to it.fireAt })
        trustedThisProcess = true
    }

    /** Local only: Graph never hears about a snooze. */
    fun snooze(context: Context, taskId: String, listId: String) {
        val prefs = prefs(context)
        val all = JSONObject(prefs.getString(SNOOZES, "{}")!!)
        all.put(taskId, JSONObject().put("listId", listId).put("at", Instant.now().plus(SNOOZE).toString()))
        prefs.edit().putString(SNOOZES, all.toString()).apply()
        reschedule(context, SnapshotStore.get(context))
    }

    fun canScheduleExact(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S || context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

    /** Snoozes whose task is still open and which haven't fired yet; the rest are forgotten. */
    private fun snoozes(context: Context, current: Snapshot?, now: Instant): List<Reminder> {
        val prefs = prefs(context)
        val all = JSONObject(prefs.getString(SNOOZES, "{}")!!)
        val open = current?.tasks?.map { it.id }?.toSet() ?: emptySet()
        val keep = JSONObject()
        val result = mutableListOf<Reminder>()
        for (taskId in all.keys()) {
            val entry = all.getJSONObject(taskId)
            val at = Instant.parse(entry.getString("at"))
            if (taskId in open && at > now.minusSeconds(60)) {
                keep.put(taskId, entry)
                result += Reminder(taskId, entry.getString("listId"), at, snoozeKey(taskId))
            }
        }
        if (keep.length() != all.length()) prefs.edit().putString(SNOOZES, keep.toString()).apply()
        return result
    }

    /**
     * Alarm-clock alarms, like the official To Do app: OEM battery managers (OxygenOS) stretch even
     * setExactAndAllowWhileIdle into a window of 75% of the lead time; alarm clocks fire on time.
     * Without the exact-alarm permission, an inexact alarm is the best Android allows.
     */
    private fun arm(context: Context, r: Reminder) {
        val am = context.getSystemService(AlarmManager::class.java)
        val pi = alarmIntent(context, r.key, r.taskId, r.listId, PendingIntent.FLAG_UPDATE_CURRENT)!!
        val at = r.fireAt.toEpochMilli()
        if (canScheduleExact(context)) am.setAlarmClock(AlarmManager.AlarmClockInfo(at, Notifications.openTaskIntent(context, r.listId, r.taskId)), pi)
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }

    private fun cancelAlarm(context: Context, key: String) {
        val pi = alarmIntent(context, key, null, null, PendingIntent.FLAG_NO_CREATE) ?: return
        context.getSystemService(AlarmManager::class.java).cancel(pi)
        pi.cancel()
    }

    private fun alarmIntent(context: Context, key: String, taskId: String?, listId: String?, flags: Int): PendingIntent? {
        val intent = Intent(context, ReminderReceiver::class.java)
            .setAction(ReminderReceiver.ACTION_FIRE)
            // The data URI makes each reminder's PendingIntent distinct (extras don't count).
            .setData(Uri.parse("woutist://reminder/" + Uri.encode(key)))
        if (taskId != null) intent.putExtra(ReminderReceiver.EXTRA_TASK_ID, taskId).putExtra(ReminderReceiver.EXTRA_LIST_ID, listId)
        return PendingIntent.getBroadcast(context, 0, intent, flags or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun readArmed(context: Context): Map<String, Instant> {
        val o = JSONObject(prefs(context).getString(ARMED, "{}")!!)
        return o.keys().asSequence().associateWith { Instant.parse(o.getString(it)) }
    }

    private fun writeArmed(context: Context, armed: Map<String, Instant>) {
        val o = JSONObject()
        armed.forEach { (k, v) -> o.put(k, v.toString()) }
        prefs(context).edit().putString(ARMED, o.toString()).apply()
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
