package com.wouteronarchitecture.woutist.data

import org.json.JSONObject
import java.time.Instant

/** A change made on the phone outside the WebView (notification, widget, quick add), waiting for Graph. */
sealed class PendingOp {
    abstract val id: String

    data class Complete(override val id: String, val listId: String, val taskId: String) : PendingOp()

    data class Create(
        override val id: String,
        val listId: String,
        val title: String,
        val important: Boolean,
        val dueDate: String?,
        val notes: String?,
        val createdAt: String = Instant.now().toString(),
    ) : PendingOp() {
        /** Id of the placeholder task shown until Graph returns the real one. */
        val tempTaskId get() = "$NATIVE_TMP_PREFIX$id"
    }

    fun toJson(): JSONObject = when (this) {
        is Complete -> JSONObject().put("type", "complete").put("id", id).put("listId", listId).put("taskId", taskId)
        is Create -> JSONObject().put("type", "create").put("id", id).put("listId", listId).put("title", title)
            .put("important", important).put("dueDate", dueDate ?: JSONObject.NULL).put("notes", notes ?: JSONObject.NULL)
            .put("createdAt", createdAt)
    }

    companion object {
        const val NATIVE_TMP_PREFIX = "native_tmp_"

        fun fromJson(o: JSONObject): PendingOp = when (val type = o.getString("type")) {
            "complete" -> Complete(o.getString("id"), o.getString("listId"), o.getString("taskId"))
            "create" -> Create(
                o.getString("id"), o.getString("listId"), o.getString("title"), o.optBoolean("important"),
                o.stringOrNull("dueDate"), o.stringOrNull("notes"), o.optString("createdAt"),
            )
            else -> error("Unknown pending op type $type")
        }
    }
}
