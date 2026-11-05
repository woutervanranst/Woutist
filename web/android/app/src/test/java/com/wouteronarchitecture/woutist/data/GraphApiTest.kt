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
}
