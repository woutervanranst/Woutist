package com.wouteronarchitecture.woutist.data

import org.json.JSONArray
import org.json.JSONObject

/**
 * What the WebView app tells the native side about the signed-in account (same shape as
 * `web/src/native/snapshot.ts`). Only open tasks with server ids; `reminderAt` only when the reminder is on.
 */
data class Snapshot(
    val version: Int,
    val accountKey: String,
    val generatedAt: String,
    val timeZone: String,
    val lists: List<SnapList>,
    val tasks: List<SnapTask>,
    val sort: Map<String, SortPref>,
) {
    fun toJson(): String = JSONObject()
        .put("version", version)
        .put("accountKey", accountKey)
        .put("generatedAt", generatedAt)
        .put("timeZone", timeZone)
        .put("lists", JSONArray(lists.map { JSONObject().put("id", it.id).put("name", it.name).put("wellknownListName", it.wellknownListName) }))
        .put("tasks", JSONArray(tasks.map { it.toJson() }))
        .put("sort", JSONObject().apply { sort.forEach { (k, v) -> put(k, JSONObject().put("key", v.key).put("dir", v.dir)) } })
        .toString()

    companion object {
        fun parse(json: String): Snapshot = fromJson(JSONObject(json))

        fun fromJson(o: JSONObject): Snapshot {
            val lists = o.getJSONArray("lists")
            val tasks = o.getJSONArray("tasks")
            val sort = o.optJSONObject("sort") ?: JSONObject()
            return Snapshot(
                version = o.getInt("version"),
                accountKey = o.getString("accountKey"),
                generatedAt = o.getString("generatedAt"),
                timeZone = o.getString("timeZone"),
                lists = (0 until lists.length()).map { i ->
                    lists.getJSONObject(i).let { SnapList(it.getString("id"), it.getString("name"), it.optString("wellknownListName", "none")) }
                },
                tasks = (0 until tasks.length()).map { i -> SnapTask.fromJson(tasks.getJSONObject(i)) },
                sort = sort.keys().asSequence().associateWith { k ->
                    sort.getJSONObject(k).let { SortPref(it.getString("key"), it.getString("dir")) }
                },
            )
        }
    }
}

data class SnapList(val id: String, val name: String, val wellknownListName: String)

data class SnapTask(
    val id: String,
    val listId: String,
    val title: String,
    val important: Boolean,
    val dueDate: String?,
    val reminderAt: String?,
    val createdDateTime: String,
    val recurring: Boolean,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("listId", listId)
        .put("title", title)
        .put("important", important)
        .put("dueDate", dueDate ?: JSONObject.NULL)
        .put("reminderAt", reminderAt ?: JSONObject.NULL)
        .put("createdDateTime", createdDateTime)
        .put("recurring", recurring)

    companion object {
        fun fromJson(o: JSONObject) = SnapTask(
            id = o.getString("id"),
            listId = o.getString("listId"),
            title = o.optString("title"),
            important = o.optBoolean("important"),
            dueDate = o.stringOrNull("dueDate"),
            reminderAt = o.stringOrNull("reminderAt"),
            createdDateTime = o.optString("createdDateTime"),
            recurring = o.optBoolean("recurring"),
        )
    }
}

data class SortPref(val key: String, val dir: String)

internal fun JSONObject.stringOrNull(key: String): String? = if (isNull(key)) null else getString(key)
