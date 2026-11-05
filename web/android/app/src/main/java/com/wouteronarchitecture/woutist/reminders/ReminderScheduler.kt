package com.wouteronarchitecture.woutist.reminders

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
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
    private const val FIRED = "fired"
    val SNOOZE: Duration = Duration.ofMinutes(10)

    /** Android allows an app 500 alarms; the nearest ones are armed and the rest follow as they come closer. */
    const val MAX_ALARMS = 400

    /** How far back a reminder lost to a reboot or force-stop is still shown (late). */
    private val MISSED_WINDOW: Duration = Duration.ofHours(12)

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
        val nearest = desired.take(MAX_ALARMS)
        val (cancel, set) = diff(armed, nearest)
        return if (force) cancel to nearest.filter { it.fireAt > now } else cancel to set
    }

    /**
     * Reminders whose alarm was armed, came due within the last 12 hours and never went off (the
     * phone was off, or the app force-stopped), and whose task still has that reminder (or snooze).
     */
    fun missed(armed: Map<String, Instant>, fired: Map<String, Instant>, current: Snapshot?, now: Instant): List<Reminder> =
        armed.entries
            .filter { (key, at) -> at <= now && at > now.minus(MISSED_WINDOW) && fired[key] != at }
            .mapNotNull { (key, at) ->
                val snooze = key.startsWith("snooze:")
                val taskId = key.removePrefix("snooze:")
                val task = current?.tasks?.firstOrNull { it.id == taskId }
                if (task != null && shouldNotify(current, taskId, if (snooze) null else at.toString())) Reminder(taskId, task.listId, at, key) else null
            }
            .sortedBy { it.fireAt }

    fun reschedule(context: Context, store: SnapshotStore, force: Boolean = false) = synchronized(this) {
        val now = Instant.now()
        val current = store.current()
        val desired = ((current?.let { ReminderRules.desired(it, now) } ?: emptyList()) + snoozes(context, current, now)).sortedBy { it.fireAt }
        val armed = readArmed(context)
        val forced = force || !trustedThisProcess
        if (forced && current != null) {
            // Alarms were lost (reboot, force-stop): show what came due meanwhile, late rather than never.
            missed(armed, readFired(context), current, now).forEach { r ->
                markFiredLocked(context, r.key, r.fireAt, now)
                Notifications.showReminder(context, current, r.taskId)
            }
        }
        val (cancel, set) = plan(armed, desired, now, forced)
        cancel.forEach { cancelAlarm(context, it) }
        val failed = mutableSetOf<String>()
        for (r in set) {
            try {
                arm(context, r)
            } catch (e: Exception) {
                // e.g. Android's per-app alarm limit; the rest are retried on the next change.
                Log.w("Woutist", "Arming a reminder failed", e)
                failed += r.key
            }
        }
        writeArmed(context, desired.take(MAX_ALARMS).filter { it.key !in failed }.associate { it.key to it.fireAt })
        // Completed or deleted elsewhere: its notification goes too.
        Notifications.cancelAllExcept(context, current?.tasks?.map { it.id }?.toSet() ?: emptySet())
        trustedThisProcess = true
    }

    /** Records that the alarm for [key] at [fireAt] went off. False when it was already shown. */
    fun markFired(context: Context, key: String, fireAt: Instant): Boolean = synchronized(this) {
        markFiredLocked(context, key, fireAt, Instant.now())
    }

    private fun markFiredLocked(context: Context, key: String, fireAt: Instant, now: Instant): Boolean {
        val fired = readFired(context).filterValues { it > now.minus(Duration.ofDays(1)) }.toMutableMap()
        if (fired[key] == fireAt) return false
        fired[key] = fireAt
        val o = JSONObject()
        fired.forEach { (k, v) -> o.put(k, v.toString()) }
        prefs(context).edit().putString(FIRED, o.toString()).apply()
        return true
    }

    /** Local only: Graph never hears about a snooze. */
    fun snooze(context: Context, taskId: String, listId: String) {
        synchronized(this) {
            val prefs = prefs(context)
            val all = JSONObject(prefs.getString(SNOOZES, "{}")!!)
            all.put(taskId, JSONObject().put("listId", listId).put("at", Instant.now().plus(SNOOZE).toString()))
            prefs.edit().putString(SNOOZES, all.toString()).apply()
        }
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
        val pi = alarmIntent(context, r, PendingIntent.FLAG_UPDATE_CURRENT)!!
        val at = r.fireAt.toEpochMilli()
        if (canScheduleExact(context)) am.setAlarmClock(AlarmManager.AlarmClockInfo(at, Notifications.openTaskIntent(context, r.listId, r.taskId)), pi)
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }

    private fun cancelAlarm(context: Context, key: String) {
        val pi = alarmIntent(context, key, null, PendingIntent.FLAG_NO_CREATE) ?: return
        context.getSystemService(AlarmManager::class.java).cancel(pi)
        pi.cancel()
    }

    private fun alarmIntent(context: Context, r: Reminder, flags: Int) = alarmIntent(context, r.key, r, flags)

    private fun alarmIntent(context: Context, key: String, r: Reminder?, flags: Int): PendingIntent? {
        val intent = Intent(context, ReminderReceiver::class.java)
            .setAction(ReminderReceiver.ACTION_FIRE)
            // The data URI makes each reminder's PendingIntent distinct (extras don't count).
            .setData(Uri.parse("woutist://reminder/" + Uri.encode(key)))
        if (r != null) {
            intent.putExtra(ReminderReceiver.EXTRA_TASK_ID, r.taskId)
                .putExtra(ReminderReceiver.EXTRA_LIST_ID, r.listId)
                .putExtra(ReminderReceiver.EXTRA_KEY, r.key)
                .putExtra(ReminderReceiver.EXTRA_FIRE_AT, r.fireAt.toString())
        }
        return PendingIntent.getBroadcast(context, 0, intent, flags or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun readArmed(context: Context): Map<String, Instant> = readMap(context, ARMED)

    private fun readFired(context: Context): Map<String, Instant> = readMap(context, FIRED)

    private fun readMap(context: Context, name: String): Map<String, Instant> {
        val o = JSONObject(prefs(context).getString(name, "{}")!!)
        return o.keys().asSequence().associateWith { Instant.parse(o.getString(it)) }
    }

    private fun writeArmed(context: Context, armed: Map<String, Instant>) {
        val o = JSONObject()
        armed.forEach { (k, v) -> o.put(k, v.toString()) }
        prefs(context).edit().putString(ARMED, o.toString()).apply()
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
