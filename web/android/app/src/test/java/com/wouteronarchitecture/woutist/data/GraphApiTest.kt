package com.wouteronarchitecture.woutist.data

import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.time.ZoneId

class GraphApiTest {
    private val zone = ZoneId.of("Europe/Brussels")

    private fun api(capture: (JSONObject) -> Unit) = GraphApi({ "token" }, zone, OkHttpClient.Builder().addInterceptor { chain ->
        val req = chain.request()
        capture(JSONObject(Buffer().also { req.body!!.writeTo(it) }.readUtf8()))
        val body = """{"id":"T9","title":"Milk","createdDateTime":"2026-11-05T12:00:00Z"}"""
        Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(201).message("Created")
            .body(body.toResponseBody("application/json".toMediaType())).build()
    }.build())

    /** Only native To Do fields, with wall-clock times in the phone's zone (like the web app). */
    @Test fun createWritesNativeDueDateAndReminder() = runBlocking {
        var sent = JSONObject()
        val created = api { sent = it }.createTask("L1", "Milk", false, "2026-11-06", "2026-11-06T08:00:00Z", null)
        assertEquals("2026-11-06T00:00:00", sent.getJSONObject("dueDateTime").getString("dateTime"))
        assertEquals("Europe/Brussels", sent.getJSONObject("dueDateTime").getString("timeZone"))
        assertEquals(true, sent.getBoolean("isReminderOn"))
        assertEquals("2026-11-06T09:00:00", sent.getJSONObject("reminderDateTime").getString("dateTime"))
        assertEquals("Europe/Brussels", sent.getJSONObject("reminderDateTime").getString("timeZone"))
        assertEquals("2026-11-06T08:00:00Z", created.reminderAt)
        assertEquals(setOf("title", "dueDateTime", "isReminderOn", "reminderDateTime"), sent.keys().asSequence().toSet())
    }

    @Test fun createWithoutReminderLeavesItOff() = runBlocking {
        var sent = JSONObject()
        api { sent = it }.createTask("L1", "Milk", false, null, null, null)
        assertFalse(sent.has("isReminderOn"))
        assertFalse(sent.has("reminderDateTime"))
    }

    private fun respond(code: Int, body: String, seen: MutableList<okhttp3.Request>) = GraphApi({ "token" }, zone, OkHttpClient.Builder().addInterceptor { chain ->
        seen += chain.request()
        Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(code).message("OK")
            .body(body.toResponseBody("application/json".toMediaType())).build()
    }.build())

    @Test fun listsSubscriptions() = runBlocking {
        val seen = mutableListOf<okhttp3.Request>()
        val body = """{"value":[{"id":"S1","resource":"/me/todo/lists/L1/tasks","notificationUrl":"https://api.test/n","expirationDateTime":"2026-11-08T10:00:00Z","clientState":null}]}"""
        val subs = respond(200, body, seen).listSubscriptions()
        assertEquals("https://graph.microsoft.com/v1.0/subscriptions", seen.single().url.toString())
        assertEquals(listOf(GraphSubscription("S1", "https://api.test/n", java.time.Instant.parse("2026-11-08T10:00:00Z"))), subs)
    }

    @Test fun renewsASubscription() = runBlocking {
        val seen = mutableListOf<okhttp3.Request>()
        respond(200, """{"id":"S1"}""", seen).renewSubscription("S1", java.time.Instant.parse("2026-11-09T10:00:00Z"))
        val req = seen.single()
        assertEquals("PATCH", req.method)
        assertEquals("https://graph.microsoft.com/v1.0/subscriptions/S1", req.url.toString())
        val sent = JSONObject(Buffer().also { req.body!!.writeTo(it) }.readUtf8())
        assertEquals("2026-11-09T10:00:00Z", sent.getString("expirationDateTime"))
    }
}
