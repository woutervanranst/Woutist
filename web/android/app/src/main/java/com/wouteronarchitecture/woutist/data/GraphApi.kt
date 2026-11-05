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

    private fun tasksUrl(listId: String): HttpUrl =
        BASE.newBuilder().addPathSegments("me/todo/lists").addPathSegment(listId).addPathSegment("tasks").build()

    private fun taskUrl(listId: String, taskId: String): HttpUrl =
        tasksUrl(listId).newBuilder().addPathSegment(taskId).build()

    private suspend fun send(method: String, url: HttpUrl, body: JSONObject?): JSONObject? {
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
