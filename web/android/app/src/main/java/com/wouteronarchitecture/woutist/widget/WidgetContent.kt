package com.wouteronarchitecture.woutist.widget

import com.wouteronarchitecture.woutist.data.SnapTask
import com.wouteronarchitecture.woutist.data.Snapshot
import com.wouteronarchitecture.woutist.data.SortPref
import org.json.JSONObject
import java.net.URLEncoder
import java.text.Collator
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** What a widget shows (same shape as `WidgetSource` in `web/src/native/snapshot.ts`). */
sealed class WidgetSource {
    /** A list; an unknown id (deleted elsewhere, or no snapshot yet) shows Tasks. */
    data class List(val listId: String) : WidgetSource()

    /** `today`, `important` or `planned`. */
    data class Smart(val id: String) : WidgetSource()

    fun toJson(): String = when (this) {
        is List -> JSONObject().put("kind", "list").put("listId", listId)
        is Smart -> JSONObject().put("kind", "smart").put("id", id)
    }.toString()

    companion object {
        fun parse(json: String): WidgetSource = runCatching {
            val o = JSONObject(json)
            if (o.getString("kind") == "smart") Smart(o.getString("id")) else List(o.getString("listId"))
        }.getOrDefault(List(""))

        /** `list:<id>` or `smart:<id>`, the app's view keys. */
        fun fromKey(key: String): WidgetSource =
            if (key.startsWith("smart:")) Smart(key.removePrefix("smart:")) else List(key.removePrefix("list:"))
    }
}

/** The widget's tasks and labels; the same rules as `widgetTasks` and `sortTasks` in the web app. */
object WidgetContent {
    private val DEFAULT_SORT = SortPref("default", "asc")

    /** The open tasks. Today is Planned up to [today]: due or overdue. */
    fun tasks(s: Snapshot, source: WidgetSource, today: LocalDate = todayIn(s)): List<SnapTask> = when (val resolved = resolve(s, source)) {
        is WidgetSource.List -> sorted(s.tasks.filter { it.listId == resolved.listId }, s.sort["list:${resolved.listId}"])
        is WidgetSource.Smart -> when (resolved.id) {
            "important" -> sorted(s.tasks.filter { it.important }, s.sort["smart:important"])
            else -> {
                val zone = zoneOf(s)
                val until = today.toString()
                s.tasks.filter { t -> plannedDate(t, zone)?.let { resolved.id != "today" || it <= until } == true }
                    .sortedWith(compareBy<SnapTask> { plannedDate(it, zone) }.then(byCreatedDesc))
            }
        }
    }

    /** The completed rows below the open ones: Today's tasks completed on [today], newest first. */
    fun doneTasks(s: Snapshot, source: WidgetSource, today: LocalDate = todayIn(s)): List<SnapTask> =
        if (source is WidgetSource.Smart && source.id == "today") {
            s.completedToday.filter { it.completedDate == today.toString() }.sortedWith(byCreatedDesc)
        } else {
            emptyList()
        }

    fun title(s: Snapshot?, source: WidgetSource): String = when (source) {
        is WidgetSource.Smart -> when (source.id) {
            "today" -> "Today"
            "important" -> "Important"
            else -> "Planned"
        }
        is WidgetSource.List -> s?.let { snap ->
            val id = (resolve(snap, source) as WidgetSource.List).listId
            snap.lists.firstOrNull { it.id == id }?.name
        } ?: "Tasks"
    }

    /** The app's route for the widget's view. */
    fun path(source: WidgetSource): String = when (source) {
        is WidgetSource.List -> if (source.listId.isEmpty()) "/" else "/lists/${encode(source.listId)}"
        is WidgetSource.Smart -> "/${source.id}"
    }

    fun dueLabel(t: SnapTask, today: LocalDate): String? {
        val due = t.dueDate?.let(LocalDate::parse) ?: return null
        return when (due) {
            today -> "Today"
            today.plusDays(1) -> "Tomorrow"
            today.minusDays(1) -> "Yesterday"
            else -> due.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))
        }
    }

    fun overdue(t: SnapTask, today: LocalDate): Boolean = t.dueDate?.let { LocalDate.parse(it) < today } == true

    fun listName(s: Snapshot, listId: String): String = s.lists.firstOrNull { it.id == listId }?.name.orEmpty()

    /** The list a widget's tasks come from, or new ones go to: Tasks for smart lists and unknown ids. */
    fun listIdFor(s: Snapshot, source: WidgetSource): String? {
        val default = s.lists.firstOrNull { it.wellknownListName == "defaultList" }?.id
        return when (source) {
            is WidgetSource.List -> source.listId.takeIf { id -> s.lists.any { it.id == id } } ?: default
            is WidgetSource.Smart -> default
        }
    }

    private fun resolve(s: Snapshot, source: WidgetSource): WidgetSource = when (source) {
        is WidgetSource.Smart -> source
        is WidgetSource.List ->
            if (s.lists.any { it.id == source.listId }) source
            else WidgetSource.List(s.lists.firstOrNull { it.wellknownListName == "defaultList" }?.id.orEmpty())
    }

    private val byCreatedDesc: Comparator<SnapTask> = compareByDescending { it.createdDateTime }

    /** `sortTasks` from `web/src/models/views.ts`; ties go newest first. */
    private fun sorted(tasks: List<SnapTask>, pref: SortPref?): List<SnapTask> {
        val p = pref ?: DEFAULT_SORT
        val dir = if (p.dir == "asc") 1 else -1
        val titles = Collator.getInstance().apply { strength = Collator.PRIMARY }
        val primary: Comparator<SnapTask> = when (p.key) {
            "createdDateTime" -> Comparator { a, b -> dir * a.createdDateTime.compareTo(b.createdDateTime) }
            "title" -> Comparator { a, b -> dir * titles.compare(a.title, b.title) }
            "importance" -> Comparator { a, b -> dir * (rank(a) - rank(b)) }
            "dueDate" -> Comparator { a, b ->
                when {
                    a.dueDate == null && b.dueDate == null -> 0
                    a.dueDate == null -> 1
                    b.dueDate == null -> -1
                    else -> dir * a.dueDate.compareTo(b.dueDate)
                }
            }
            else -> byCreatedDesc
        }
        return tasks.sortedWith(primary.then(byCreatedDesc))
    }

    /** Like JS encodeURIComponent for Graph ids (letters, digits, `-`, `_`, `=`). */
    private fun encode(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    private fun rank(t: SnapTask) = if (t.important) 0 else 1

    private fun plannedDate(t: SnapTask, zone: ZoneId): String? =
        t.dueDate ?: t.reminderAt?.let { Instant.parse(it).atZone(zone).toLocalDate().toString() }

    /** The phone's date in the snapshot's zone. */
    fun todayIn(s: Snapshot): LocalDate = LocalDate.now(zoneOf(s))

    private fun zoneOf(s: Snapshot): ZoneId = runCatching { ZoneId.of(s.timeZone) }.getOrDefault(ZoneId.systemDefault())
}
