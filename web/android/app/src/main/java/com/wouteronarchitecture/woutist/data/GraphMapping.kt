package com.wouteronarchitecture.woutist.data

import org.json.JSONObject
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset

/** Graph JSON → snapshot entries (same rules as `web/src/models/time.ts` and `todo.ts`). */
object GraphMapping {
    fun list(json: JSONObject) = SnapList(
        id = json.getString("id"),
        name = json.optString("displayName"),
        wellknownListName = json.optString("wellknownListName").ifEmpty { "none" },
    )

    fun task(json: JSONObject, listId: String, zone: ZoneId) = SnapTask(
        id = json.getString("id"),
        listId = listId,
        title = json.optString("title"),
        important = json.optString("importance") == "high",
        dueDate = json.optJSONObject("dueDateTime")?.let { localDate(it, zone) },
        reminderAt = if (json.optBoolean("isReminderOn")) json.optJSONObject("reminderDateTime")?.let { instant(it).toString() } else null,
        createdDateTime = json.optString("createdDateTime"),
        recurring = json.optJSONObject("recurrence") != null,
    )

    /** A Graph `dateTimeTimeZone` as an instant. Unknown zones count as UTC, like the web app. */
    fun instant(value: JSONObject): Instant =
        LocalDateTime.parse(value.getString("dateTime")).atZone(zoneOf(value.optString("timeZone"))).toInstant()

    /** The calendar date a Graph `dateTimeTimeZone` falls on in [zone]. */
    fun localDate(value: JSONObject, zone: ZoneId): String {
        val wall = value.getString("dateTime")
        if (value.optString("timeZone") == zone.id) return wall.take(10)
        return instant(value).atZone(zone).toLocalDate().toString()
    }

    private fun zoneOf(name: String): ZoneId =
        if (name.isBlank() || name.equals("UTC", ignoreCase = true)) ZoneOffset.UTC
        else runCatching { ZoneId.of(name) }.getOrDefault(ZoneOffset.UTC)
}
