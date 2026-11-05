package com.wouteronarchitecture.woutist.data

import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId

class GraphMappingTest {
    private val zone = ZoneId.of("Europe/Brussels")
    private fun map(json: String) = GraphMapping.task(JSONObject(json), "L1", zone)

    @Test fun dueDateIsDatePart() {
        val t = map("""{"id":"T","title":"x","dueDateTime":{"dateTime":"2026-11-06T00:00:00.0000000","timeZone":"Europe/Brussels"}}""")
        assertEquals("2026-11-06", t.dueDate)
    }

    @Test fun dueDateWrittenInUtcIsTheLocalDate() {
        // Other clients may store a due date as UTC midnight-minus-one-hour.
        val t = map("""{"id":"T","title":"x","dueDateTime":{"dateTime":"2026-11-05T23:00:00.0000000","timeZone":"UTC"}}""")
        assertEquals("2026-11-06", t.dueDate)
    }

    @Test fun reminderAcrossDstMapsToInstant() {
        val t = map("""{"id":"T","title":"x","isReminderOn":true,"reminderDateTime":{"dateTime":"2026-03-29T03:30:00.0000000","timeZone":"Europe/Brussels"}}""")
        assertEquals("2026-03-29T01:30:00Z", t.reminderAt)
    }

    @Test fun reminderIgnoredWhenOff() {
        val t = map("""{"id":"T","title":"x","isReminderOn":false,"reminderDateTime":{"dateTime":"2026-11-06T09:00:00.0000000","timeZone":"Europe/Brussels"}}""")
        assertNull(t.reminderAt)
    }

    @Test fun recurringFlag() {
        assertTrue(map("""{"id":"T","title":"x","recurrence":{"pattern":{"type":"daily","interval":1}}}""").recurring)
        assertFalse(map("""{"id":"T","title":"x","recurrence":null}""").recurring)
        assertFalse(map("""{"id":"T","title":"x"}""").recurring)
    }

    @Test fun mapsTheFixtureTask() {
        val page = JSONObject(resource("graph-tasks-page.json"))
        val t = GraphMapping.task(page.getJSONArray("value").getJSONObject(0), "L1", zone)
        assertEquals(
            SnapTask("T1", "L1", "Pay the rent", true, "2026-11-06", "2026-11-06T08:00:00Z", "2026-11-01T08:00:00.0000000Z", true),
            t,
        )
    }

    @Test fun pageWithNextLinkIsFollowed() = runBlocking {
        val requests = mutableListOf<Request>()
        val json = "application/json".toMediaType()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val req = chain.request()
            requests += req
            val body = when {
                req.url.encodedPath == "/v1.0/me/todo/lists" ->
                    """{"value":[{"id":"L1","displayName":"Tasks","wellknownListName":"defaultList"}]}"""
                req.url.queryParameter("\$skip") == "2" ->
                    """{"value":[{"id":"T3","title":"Page two","status":"notStarted","createdDateTime":"2026-11-03T08:00:00Z"},{"id":"T4","title":"Done","status":"completed"}]}"""
                else -> resource("graph-tasks-page.json")
            }
            Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(body.toResponseBody(json)).build()
        }.build()
        val sort = mapOf("list:L1" to SortPref("dueDate", "asc"))

        val s = GraphApi({ "token" }, zone, client).fetchSnapshot("oid.tid", zone, sort)

        assertEquals(listOf("T1", "T2", "T3"), s.tasks.map { it.id })
        assertEquals(listOf(SnapList("L1", "Tasks", "defaultList")), s.lists)
        assertEquals("oid.tid", s.accountKey)
        assertEquals("Europe/Brussels", s.timeZone)
        assertEquals(sort, s.sort)
        val first = requests.first { it.url.encodedPath.endsWith("/tasks") }
        assertEquals("status ne 'completed'", first.url.queryParameter("\$filter"))
        assertEquals("outlook.timezone=\"Europe/Brussels\"", first.header("Prefer"))
        assertEquals("Bearer token", first.header("Authorization"))
    }
}
