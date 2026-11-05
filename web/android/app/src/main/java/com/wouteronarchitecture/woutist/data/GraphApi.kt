package com.wouteronarchitecture.woutist.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/** The Graph calls native code makes. Only native To Do fields are written. */
interface TaskGraph {
    suspend fun completeTask(listId: String, taskId: String)
    suspend fun createTask(listId: String, title: String, important: Boolean, dueDate: String?, notes: String?): SnapTask
}

/** Graph answered with a non-success status. */
class GraphHttpException(val status: Int, message: String) : Exception("Graph $status: $message")

/** Microsoft Graph over OkHttp. [tokens] returns an access token or throws `SignInRequired`. */
class GraphApi(
    private val tokens: suspend () -> String,
    private val zone: ZoneId = ZoneId.systemDefault(),
    private val client: OkHttpClient = sharedClient,
) : TaskGraph {

    override suspend fun completeTask(listId: String, taskId: String) {
        send("PATCH", taskUrl(listId, taskId), JSONObject().put("status", "completed"))
    }

    override suspend fun createTask(listId: String, title: String, important: Boolean, dueDate: String?, notes: String?): SnapTask {
        val body = JSONObject().put("title", title)
        if (important) body.put("importance", "high")
        if (dueDate != null) body.put("dueDateTime", JSONObject().put("dateTime", "${dueDate}T00:00:00").put("timeZone", zone.id))
        if (!notes.isNullOrBlank()) body.put("body", JSONObject().put("content", notes).put("contentType", "text"))
        val created = requireNotNull(send("POST", tasksUrl(listId), body)) { "Graph returned no task" }
        return SnapTask(
            id = created.getString("id"),
            listId = listId,
            title = created.optString("title", title),
            important = important,
            dueDate = dueDate,
            reminderAt = null,
            createdDateTime = created.optString("createdDateTime"),
            recurring = false,
        )
    }

    /** The account's lists and open tasks, read fresh from Graph (the background refresh). */
    suspend fun fetchSnapshot(accountKey: String, zone: ZoneId, sort: Map<String, SortPref>): Snapshot {
        val lists = getAll(BASE.newBuilder().addPathSegments("me/todo/lists").build(), zone).map(GraphMapping::list)
        val tasks = lists.flatMap { list ->
            // $select can't include title (Graph answers 400), so full tasks are read and mapped.
            val url = tasksUrl(list.id).newBuilder().addQueryParameter("\$filter", "status ne 'completed'").build()
            getAll(url, zone).filter { it.optString("status") != "completed" }.map { GraphMapping.task(it, list.id, zone) }
        }
        return Snapshot(1, accountKey, Instant.now().toString(), zone.id, lists, tasks, sort)
    }

    /** Every item of a collection, following `@odata.nextLink` (only to Graph itself: it carries the token). */
    private suspend fun getAll(first: HttpUrl, zone: ZoneId): List<JSONObject> {
        val items = mutableListOf<JSONObject>()
        var next: HttpUrl? = first
        while (next != null) {
            val page = requireNotNull(send("GET", next, null, zone)) { "Graph returned no page" }
            val value = page.optJSONArray("value")
            if (value != null) for (i in 0 until value.length()) items += value.getJSONObject(i)
            next = page.optString("@odata.nextLink").takeIf { it.isNotEmpty() }?.toHttpUrl()?.takeIf { it.host == BASE.host }
        }
        return items
    }

    private fun tasksUrl(listId: String): HttpUrl =
        BASE.newBuilder().addPathSegments("me/todo/lists").addPathSegment(listId).addPathSegment("tasks").build()

    private fun taskUrl(listId: String, taskId: String): HttpUrl =
        tasksUrl(listId).newBuilder().addPathSegment(taskId).build()

    private suspend fun send(method: String, url: HttpUrl, body: JSONObject?, zone: ZoneId = this.zone): JSONObject? {
        val token = tokens()
        return withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url(url)
                .header("Authorization", "Bearer $token")
                .header("Prefer", "outlook.timezone=\"${zone.id}\"")
                .method(method, body?.toString()?.toRequestBody(JSON))
                .build()
            client.newCall(request).execute().use { response ->
                val text = response.body.string()
                if (!response.isSuccessful) throw GraphHttpException(response.code, text.take(300))
                text.takeIf { it.isNotBlank() }?.let(::JSONObject)
            }
        }
    }

    companion object {
        private val BASE = "https://graph.microsoft.com/v1.0".toHttpUrl()
        private val JSON = "application/json".toMediaType()
        private val sharedClient by lazy {
            OkHttpClient.Builder().callTimeout(30, TimeUnit.SECONDS).build()
        }
    }
}
