package com.wouteronarchitecture.woutist.data

fun task(
    id: String,
    listId: String = "L1",
    title: String = id,
    dueDate: String? = null,
    reminderAt: String? = null,
    recurring: Boolean = false,
) = SnapTask(id, listId, title, important = false, dueDate = dueDate, reminderAt = reminderAt, createdDateTime = "2026-11-01T10:00:00Z", recurring = recurring)

fun snapshot(vararg tasks: SnapTask, accountKey: String = "oid.tid") = Snapshot(
    version = 1,
    accountKey = accountKey,
    generatedAt = "2026-11-05T08:00:00Z",
    timeZone = "Europe/Brussels",
    lists = listOf(SnapList("L1", "Tasks", "defaultList")),
    tasks = tasks.toList(),
    sort = emptyMap(),
)

fun resource(name: String): String =
    requireNotNull(Thread.currentThread().contextClassLoader?.getResource(name)) { "missing test resource $name" }.readText()
