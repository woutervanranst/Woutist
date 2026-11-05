import type { Prefs } from '../app/prefs'
import { isTempId, type Task, type TodoList, type WellknownListName } from '../models/todo'
import type { SortPref } from '../models/views'
import { upcomingReminders } from '../services/push/reminders'

/**
 * What the Android app's native side (reminders, widget, quick add) knows about the account.
 * Same shape as `data/Snapshot.kt`; only open tasks with server ids are included.
 */
export interface NativeSnapshot {
  version: 1
  accountKey: string
  generatedAt: string
  timeZone: string
  lists: { id: string; name: string; wellknownListName: WellknownListName }[]
  tasks: NativeSnapshotTask[]
  sort: Record<string, SortPref>
  /** Local changes not in Graph yet: the phone's background refresh must not replace this snapshot. */
  outboxPending: boolean
}

export interface NativeSnapshotTask {
  id: string
  listId: string
  title: string
  important: boolean
  dueDate: string | null
  /** ISO instant, set only when the reminder is on. */
  reminderAt: string | null
  createdDateTime: string
  recurring: boolean
}

export interface NativeReminder {
  taskId: string
  listId: string
  fireAt: string
}

export function buildSnapshot(input: {
  accountKey: string
  lists: TodoList[]
  tasks: Task[]
  sort: Prefs['sort']
  now: Date
  timeZone: string
  outboxPending?: boolean
}): NativeSnapshot {
  const lists = input.lists
    .filter((l) => !isTempId(l.id))
    .sort((a, b) => a.sortIndex - b.sortIndex)
    .map((l) => ({ id: l.id, name: l.displayName, wellknownListName: l.wellknownListName }))
  const tasks = input.tasks
    .filter((t) => !t.completed && !isTempId(t.id) && !isTempId(t.listId))
    .map((t) => ({
      id: t.id,
      listId: t.listId,
      title: t.title,
      important: t.importance === 'high',
      dueDate: t.dueDate,
      reminderAt: t.isReminderOn && t.reminderAt ? new Date(t.reminderAt).toISOString() : null,
      createdDateTime: t.createdDateTime,
      recurring: t.recurrence !== null,
    }))
  return {
    version: 1,
    accountKey: input.accountKey,
    generatedAt: input.now.toISOString(),
    timeZone: input.timeZone,
    lists,
    tasks,
    sort: input.sort,
    outboxPending: input.outboxPending ?? false,
  }
}

/** The reminders the phone should arm for a snapshot (same rules as Web Push). */
export function remindersFromSnapshot(s: NativeSnapshot, now: Date): NativeReminder[] {
  return upcomingReminders(
    s.tasks
      .filter((t) => t.reminderAt !== null)
      .map((t) => ({ taskId: t.id, listId: t.listId, fireAt: new Date(t.reminderAt!).toISOString() })),
    now,
  )
}
