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
import java.time.Instant
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

    @Test fun completedDateIsTheLocalDate() {
        // 23:30 UTC on the 4th is the 5th in Brussels.
        val t = map("""{"id":"T","title":"x","status":"completed","completedDateTime":{"dateTime":"2026-11-04T23:30:00.0000000","timeZone":"UTC"}}""")
        assertEquals("2026-11-05", t.completedDate)
        assertNull(map("""{"id":"T","title":"x"}""").completedDate)
    }

    private fun graphClient(requests: MutableList<Request>, completed: (Request) -> Pair<Int, String>) =
        OkHttpClient.Builder().addInterceptor { chain ->
            val req = chain.request()
            requests += req
            val filter = req.url.queryParameter("\$filter").orEmpty()
            val (code, body) = when {
                req.url.encodedPath == "/v1.0/me/todo/lists" ->
                    200 to """{"value":[{"id":"L1","displayName":"Tasks","wellknownListName":"defaultList"}]}"""
                filter.startsWith("status eq 'completed'") -> completed(req)
                else -> 200 to """{"value":[{"id":"OPEN","title":"Open","status":"notStarted","createdDateTime":"2026-11-03T08:00:00Z"}]}"""
            }
            Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(code).message("x")
                .body(body.toResponseBody("application/json".toMediaType())).build()
        }.build()

    private val now = Instant.parse("2026-11-05T08:00:00Z")

    @Test fun fetchReadsTasksCompletedToday() = runBlocking {
        val requests = mutableListOf<Request>()
        val client = graphClient(requests) {
            200 to """{"value":[
                {"id":"D1","title":"Done today","status":"completed","createdDateTime":"2026-11-01T08:00:00Z","completedDateTime":{"dateTime":"2026-11-05T07:00:00.0000000","timeZone":"UTC"}},
                {"id":"D0","title":"Done yesterday","status":"completed","createdDateTime":"2026-11-01T08:00:00Z","completedDateTime":{"dateTime":"2026-11-04T10:00:00.0000000","timeZone":"UTC"}}
            ]}"""
        }

        val s = GraphApi({ "token" }, zone, client).fetchSnapshot("oid.tid", zone, emptyMap(), now = now)

        assertEquals(listOf("OPEN"), s.tasks.map { it.id })
        assertEquals(listOf("D1" to "2026-11-05"), s.completedToday.map { it.id to it.completedDate })
        // From local midnight a day early, in UTC: the date is checked after mapping.
        val query = requests.single { it.url.queryParameter("\$filter").orEmpty().startsWith("status eq") }
        assertEquals("status eq 'completed' and completedDateTime/dateTime ge '2026-11-03T23:00:00'", query.url.queryParameter("\$filter"))
    }

    @Test fun refusedCompletedFilterKeepsTodaysFallback() = runBlocking {
        val client = graphClient(mutableListOf()) { 400 to """{"error":{"code":"BadRequest"}}""" }
        val fallback = listOf(
            SnapTask("F1", "L1", "Still today", false, null, null, "2026-11-01T08:00:00Z", false, completedDate = "2026-11-05"),
            SnapTask("F0", "L1", "Yesterday", false, null, null, "2026-11-01T08:00:00Z", false, completedDate = "2026-11-04"),
        )

        val s = GraphApi({ "token" }, zone, client).fetchSnapshot("oid.tid", zone, emptyMap(), fallbackCompleted = fallback, now = now)

        assertEquals(listOf("OPEN"), s.tasks.map { it.id })
        assertEquals(listOf("F1"), s.completedToday.map { it.id })
    }
}
