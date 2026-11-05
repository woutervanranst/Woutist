import type { Prefs } from '../app/prefs'
import { isTempId, type Task, type TodoList, type WellknownListName } from '../models/todo'
import { instantToLocalDate } from '../models/time'
import { sortTasks, type SortPref } from '../models/views'
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

/** What a home-screen widget shows (same shape as `WidgetSource` in `widget/WidgetContent.kt`). */
export type WidgetSource = { kind: 'list'; listId: string } | { kind: 'smart'; id: 'important' | 'planned' }

const DEFAULT_SORT: SortPref = { key: 'default', dir: 'asc' }

/**
 * The widget's tasks, in the app's order: a list with its sort preference (an unknown list falls
 * back to Tasks), Important with its sort preference, Planned by date then newest first.
 * The Android widget implements the same rules; both are checked against `widget-expected.json`.
 */
export function widgetTasks(s: NativeSnapshot, source: WidgetSource): NativeSnapshotTask[] {
  const sorted = (tasks: NativeSnapshotTask[], key: string) =>
    sortTasks(
      tasks.map((task) => ({
        task,
        createdDateTime: task.createdDateTime,
        title: task.title,
        dueDate: task.dueDate,
        importance: task.important ? ('high' as const) : ('normal' as const),
      })),
      s.sort[key] ?? DEFAULT_SORT,
    ).map((w) => w.task)
  if (source.kind === 'list') {
    const known = s.lists.some((l) => l.id === source.listId)
    const listId = known ? source.listId : s.lists.find((l) => l.wellknownListName === 'defaultList')?.id
    return sorted(s.tasks.filter((t) => t.listId === listId), `list:${listId}`)
  }
  if (source.id === 'important') return sorted(s.tasks.filter((t) => t.important), 'smart:important')
  const plannedDate = (t: NativeSnapshotTask) =>
    t.dueDate ?? (t.reminderAt ? instantToLocalDate(new Date(t.reminderAt), s.timeZone) : null)
  return s.tasks
    .filter((t) => plannedDate(t) !== null)
    .sort((a, b) => plannedDate(a)!.localeCompare(plannedDate(b)!) || b.createdDateTime.localeCompare(a.createdDateTime))
}
