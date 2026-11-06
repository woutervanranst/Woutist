package com.wouteronarchitecture.woutist.data

import android.content.Context
import com.wouteronarchitecture.woutist.reminders.ReminderScheduler
import com.wouteronarchitecture.woutist.widget.TaskListWidget
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId

/**
 * The native side's view of the account: the last snapshot from the WebView app (the base) plus the
 * operations made on the phone that Graph hasn't confirmed yet. Persisted as files so alarms, the
 * widget and workers see it when the app isn't running. Every change calls [onChanged].
 */
class SnapshotStore(
    private val dir: File,
    private val clock: Clock = Clock.systemUTC(),
    private val onChanged: (SnapshotStore) -> Unit = {},
) {
    private val lock = Any()
    private val changes = MutableStateFlow(0L)

    /** Bumped on every change, so an open widget recomposes. */
    val version: StateFlow<Long> = changes.asStateFlow()
    private var base: Snapshot? = read(BASE)?.let { runCatching { Snapshot.parse(it) }.getOrNull() }
    private var ops: List<PendingOp> = read(PENDING)?.let { json ->
        runCatching { JSONArray(json).let { a -> (0 until a.length()).map { PendingOp.fromJson(a.getJSONObject(it)) } } }.getOrNull()
    } ?: emptyList()
    private val flags: JSONObject? = read(FLAGS)?.let { runCatching { JSONObject(it) }.getOrNull() }
    private var signInFlag: Boolean = flags?.optBoolean("needsSignIn") ?: false
    private var hookUrl: String? = flags?.optString("notificationUrl")?.takeIf { it.isNotEmpty() }

    /** Set by background work when Graph needs an interactive sign-in; cleared when the app sends a snapshot. */
    var needsSignIn: Boolean
        get() = synchronized(lock) { signInFlag }
        set(value) = mutate { signInFlag = value; saveFlags() }

    /**
     * Where this account's Graph subscriptions send notifications (from the app), so background work renews
     * only those. Not a change to the account's data: listeners aren't notified.
     */
    var notificationUrl: String?
        get() = synchronized(lock) { hookUrl }
        set(value) = synchronized(lock) {
            hookUrl = value
            saveFlags()
        }

    /** The app's latest snapshot. Another account's snapshot first drops this account's pending operations. */
    fun replaceBase(s: Snapshot) = mutate { replace(s) }

    /** [replaceBase], unless the base changed since [generatedAt] was read (a newer snapshot wins). */
    fun replaceBaseIfUnchanged(generatedAt: String, s: Snapshot): Boolean {
        var replaced = false
        mutate {
            if (base?.generatedAt == generatedAt) {
                replace(s)
                replaced = true
            }
        }
        return replaced
    }

    private fun replace(s: Snapshot) {
        if (base?.accountKey != null && base?.accountKey != s.accountKey) {
            ops = emptyList()
            savePending()
        }
        base = s
        signInFlag = false
        saveBase()
        saveFlags()
    }

    /**
     * The base with pending operations applied: completed tasks moved to [Snapshot.completedToday],
     * created tasks appended.
     */
    fun current(): Snapshot? = synchronized(lock) {
        val b = base ?: return null
        val completed = ops.filterIsInstance<PendingOp.Complete>().map { it.taskId }.toSet()
        val created = ops.filterIsInstance<PendingOp.Create>().map {
            SnapTask(it.tempTaskId, it.listId, it.title, it.important, it.dueDate, it.reminderAt, it.createdAt, false)
        }
        b.completing(completed).let { it.copy(tasks = it.tasks + created) }
    }

    /** [ids] taken out of the open tasks and listed as completed today (in the snapshot's zone). */
    private fun Snapshot.completing(ids: Set<String>): Snapshot {
        if (ids.isEmpty()) return this
        val today = LocalDate.now(clock.withZone(zoneOf(timeZone))).toString()
        val done = tasks.filter { it.id in ids }.map { it.copy(completedDate = today) }
        return copy(
            tasks = tasks.filter { it.id !in ids },
            completedToday = completedToday.filter { it.id !in ids } + done,
        )
    }

    private fun zoneOf(name: String): ZoneId = runCatching { ZoneId.of(name) }.getOrDefault(ZoneId.systemDefault())

    fun addPending(op: PendingOp) = mutate {
        ops = ops + op
        savePending()
    }

    /**
     * Forget an operation Graph has confirmed (or rejected for good). Its effect stays in the base until
     * the next snapshot: a completed task stays among today's completed ones (a recurring one comes back
     * with its next date in that snapshot), and a created task is shown as [created] when Graph returned it.
     */
    fun removePending(opId: String, created: SnapTask? = null) = mutate {
        val op = ops.find { it.id == opId } ?: return@mutate
        ops = ops - op
        savePending()
        val b = base ?: return@mutate
        base = when (op) {
            is PendingOp.Complete -> b.completing(setOf(op.taskId))
            is PendingOp.Create -> if (created != null) b.copy(tasks = b.tasks + created) else b
        }
        saveBase()
    }

    /** Forget an operation Graph refused: it never happened, so the base stays as it is. */
    fun dropPending(opId: String) = mutate {
        ops = ops.filterNot { it.id == opId }
        savePending()
    }

    fun pending(): List<PendingOp> = synchronized(lock) { ops }

    /** Sign-out: forget everything about the account. */
    fun clear() = mutate {
        base = null
        ops = emptyList()
        signInFlag = false
        hookUrl = null
        listOf(BASE, PENDING, FLAGS).forEach { File(dir, it).delete() }
    }

    private inline fun mutate(block: () -> Unit) {
        synchronized(lock) {
            block()
            changes.value += 1
        }
        onChanged(this)
    }

    private fun saveBase() = write(BASE, base?.toJson())
    private fun savePending() = write(PENDING, JSONArray(ops.map { it.toJson() }).toString())
    private fun saveFlags() =
        write(FLAGS, JSONObject().put("needsSignIn", signInFlag).put("notificationUrl", hookUrl ?: JSONObject.NULL).toString())

    private fun read(name: String): String? = File(dir, name).takeIf { it.exists() }?.readText()

    private fun write(name: String, text: String?) {
        val file = File(dir, name)
        if (text == null) {
            file.delete()
            return
        }
        dir.mkdirs()
        val tmp = File(dir, "$name.tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }

    companion object {
        private const val BASE = "snapshot.json"
        private const val PENDING = "pending.json"
        private const val FLAGS = "flags.json"

        @Volatile private var instance: SnapshotStore? = null

        fun get(context: Context): SnapshotStore = instance ?: synchronized(this) {
            instance ?: run {
                val app = context.applicationContext
                SnapshotStore(File(app.filesDir, "native")) { store ->
                    ReminderScheduler.reschedule(app, store)
                    TaskListWidget.refreshAll(app)
                }
            }.also { instance = it }
        }
    }
}
