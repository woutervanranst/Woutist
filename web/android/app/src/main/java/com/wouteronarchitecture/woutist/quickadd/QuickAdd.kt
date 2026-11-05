package com.wouteronarchitecture.woutist.quickadd

import com.wouteronarchitecture.woutist.data.PendingOp
import com.wouteronarchitecture.woutist.data.Snapshot
import com.wouteronarchitecture.woutist.widget.WidgetContent
import com.wouteronarchitecture.woutist.widget.WidgetSource
import java.time.Instant
import java.time.LocalDate

/** Where a quick-added task goes and what it gets, like adding in that view of the app. */
object QuickAdd {
    /** Planned starts due today (the phone's local date); the user can change or clear it. */
    fun initialDue(source: WidgetSource, today: LocalDate): LocalDate? =
        today.takeIf { source is WidgetSource.Smart && source.id == "planned" }

    /**
     * A task for [source]'s list (Tasks for Important and Planned), starred from Important, with the
     * chosen due date and reminder. Null for a blank title or when no list is known.
     */
    fun create(
        s: Snapshot,
        source: WidgetSource,
        title: String,
        notes: String?,
        dueDate: LocalDate?,
        reminderAt: Instant?,
        opId: String,
    ): PendingOp.Create? {
        val name = title.trim()
        if (name.isEmpty()) return null
        val listId = WidgetContent.listIdFor(s, source) ?: return null
        val smart = (source as? WidgetSource.Smart)?.id
        return PendingOp.Create(
            id = opId,
            listId = listId,
            title = name,
            important = smart == "important",
            dueDate = dueDate?.toString(),
            notes = notes?.takeIf { it.isNotBlank() },
            reminderAt = reminderAt?.toString(),
        )
    }
}
