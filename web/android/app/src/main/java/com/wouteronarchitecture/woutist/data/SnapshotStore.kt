package com.wouteronarchitecture.woutist.data

import android.content.Context
import com.wouteronarchitecture.woutist.reminders.ReminderScheduler
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The native side's view of the account: the last snapshot from the WebView app (the base) plus the
 * operations made on the phone that Graph hasn't confirmed yet. Persisted as files so alarms, the
 * widget and workers see it when the app isn't running. Every change calls [onChanged].
 */
class SnapshotStore(private val dir: File, private val onChanged: (SnapshotStore) -> Unit = {}) {
    private val lock = Any()
    private var base: Snapshot? = read(BASE)?.let { runCatching { Snapshot.parse(it) }.getOrNull() }
    private var ops: List<PendingOp> = read(PENDING)?.let { json ->
        runCatching { JSONArray(json).let { a -> (0 until a.length()).map { PendingOp.fromJson(a.getJSONObject(it)) } } }.getOrNull()
    } ?: emptyList()
    private var signInFlag: Boolean = read(FLAGS)?.let { runCatching { JSONObject(it).optBoolean("needsSignIn") }.getOrNull() } ?: false

    /** Set by background work when Graph needs an interactive sign-in; cleared when the app sends a snapshot. */
    var needsSignIn: Boolean
        get() = synchronized(lock) { signInFlag }
        set(value) = mutate { signInFlag = value; saveFlags() }

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

    /** The base with pending operations applied: completed tasks hidden, created tasks appended. */
    fun current(): Snapshot? = synchronized(lock) {
        val b = base ?: return null
        val completed = ops.filterIsInstance<PendingOp.Complete>().map { it.taskId }.toSet()
        val created = ops.filterIsInstance<PendingOp.Create>().map {
            SnapTask(it.tempTaskId, it.listId, it.title, it.important, it.dueDate, null, it.createdAt, false)
        }
        b.copy(tasks = b.tasks.filter { it.id !in completed } + created)
    }

    fun addPending(op: PendingOp) = mutate {
        ops = ops + op
        savePending()
    }

    /**
     * Forget an operation Graph has confirmed (or rejected for good). Its effect stays in the base until
     * the next snapshot: a completed task stays hidden (a recurring one comes back with its next date in
     * that snapshot), and a created task is shown as [created] when Graph returned it.
     */
    fun removePending(opId: String, created: SnapTask? = null) = mutate {
        val op = ops.find { it.id == opId } ?: return@mutate
        ops = ops - op
        savePending()
        val b = base ?: return@mutate
        base = when (op) {
            is PendingOp.Complete -> b.copy(tasks = b.tasks.filter { it.id != op.taskId })
            is PendingOp.Create -> if (created != null) b.copy(tasks = b.tasks + created) else b
        }
        saveBase()
    }

    fun pending(): List<PendingOp> = synchronized(lock) { ops }

    /** Sign-out: forget everything about the account. */
    fun clear() = mutate {
        base = null
        ops = emptyList()
        signInFlag = false
        listOf(BASE, PENDING, FLAGS).forEach { File(dir, it).delete() }
    }

    private inline fun mutate(block: () -> Unit) {
        synchronized(lock) { block() }
        onChanged(this)
    }

    private fun saveBase() = write(BASE, base?.toJson())
    private fun savePending() = write(PENDING, JSONArray(ops.map { it.toJson() }).toString())
    private fun saveFlags() = write(FLAGS, JSONObject().put("needsSignIn", signInFlag).toString())

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
                SnapshotStore(File(app.filesDir, "native")) { store -> ReminderScheduler.reschedule(app, store) }
            }.also { instance = it }
        }
    }
}
