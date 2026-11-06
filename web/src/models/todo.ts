import type {
  ChecklistItem as GraphChecklistItem,
  LinkedResource as GraphLinkedResource,
  PatternedRecurrence,
  TodoTask as GraphTodoTask,
  TodoTaskList as GraphTodoTaskList,
} from '@microsoft/microsoft-graph-types'
import {
  graphToInstant,
  graphToLocalDate,
  instantToGraph,
  localDateToGraph,
  todayLocal,
  userTimeZone,
} from './time'

export type { PatternedRecurrence }

export type TaskStatus = 'notStarted' | 'inProgress' | 'completed' | 'waitingOnOthers' | 'deferred'
export type Importance = 'low' | 'normal' | 'high'
export type WellknownListName = 'none' | 'defaultList' | 'flaggedEmails' | 'unknownFutureValue'

/** Dexie cannot index booleans, so flags used in queries are stored as 0/1. */
export type Flag = 0 | 1

export interface TodoList {
  id: string
  displayName: string
  wellknownListName: WellknownListName
  isOwner: boolean
  isShared: boolean
  /** Position in Graph's list order (Graph doesn't expose the user's manual list order). */
  sortIndex: number
}

export interface Step {
  id: string
  displayName: string
  isChecked: boolean
  createdDateTime: string
  checkedDateTime: string | null
}

export interface LinkedResourceInfo {
  id: string
  webUrl: string | null
  applicationName: string | null
  displayName: string | null
  externalId: string | null
}

export interface Task {
  id: string
  listId: string
  title: string
  status: TaskStatus
  importance: Importance
  /** Notes (plain text). HTML bodies (e.g. flagged emails) are kept as-is in `bodyHtml`. */
  body: string
  bodyHtml: string | null
  /** Due date in the user's zone (`YYYY-MM-DD`). */
  dueDate: string | null
  /** Reminder instant (ISO-8601 UTC), only meaningful when `isReminderOn`. */
  reminderAt: string | null
  isReminderOn: boolean
  recurrence: PatternedRecurrence | null
  categories: string[]
  hasAttachments: boolean
  createdDateTime: string
  lastModifiedDateTime: string
  /** Completion date in the user's zone (`YYYY-MM-DD`). */
  completedDate: string | null
  steps: Step[]
  linkedResources: LinkedResourceInfo[]
  // Query helpers
  completed: Flag
  important: Flag
}

/** Fields of a task Woutist edits. Each maps 1:1 onto a native Graph property. */
export interface TaskChanges {
  title?: string
  status?: TaskStatus
  importance?: Importance
  body?: string
  dueDate?: string | null
  reminderAt?: string | null
  isReminderOn?: boolean
  recurrence?: PatternedRecurrence | null
  categories?: string[]
}

export const isTempId = (id: string) => id.startsWith('tmp_')
export const newTempId = () => `tmp_${crypto.randomUUID()}`

// ---------- Graph → domain ----------

export function fromGraphList(list: GraphTodoTaskList, sortIndex = 0): TodoList {
  return {
    id: list.id!,
    displayName: list.displayName ?? '',
    wellknownListName: (list.wellknownListName as WellknownListName | undefined) ?? 'none',
    isOwner: list.isOwner ?? true,
    isShared: list.isShared ?? false,
    sortIndex,
  }
}

export function fromGraphStep(item: GraphChecklistItem): Step {
  return {
    id: item.id!,
    displayName: item.displayName ?? '',
    isChecked: item.isChecked ?? false,
    createdDateTime: item.createdDateTime ?? new Date().toISOString(),
    checkedDateTime: item.checkedDateTime ?? null,
  }
}

function fromGraphLinkedResource(r: GraphLinkedResource): LinkedResourceInfo {
  return {
    id: r.id!,
    webUrl: r.webUrl ?? null,
    applicationName: r.applicationName ?? null,
    displayName: r.displayName ?? null,
    externalId: r.externalId ?? null,
  }
}

function htmlToText(html: string): string {
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return (doc.body.textContent ?? '').trim()
  }
  return html.replace(/<[^>]*>/g, '').trim()
}

export function fromGraphTask(task: GraphTodoTask, listId: string, tz = userTimeZone()): Task {
  const status = (task.status as TaskStatus | undefined) ?? 'notStarted'
  const importance = (task.importance as Importance | undefined) ?? 'normal'
  const isHtml = task.body?.contentType === 'html'
  const content = task.body?.content ?? ''
  const reminder = graphToInstant(task.reminderDateTime)
  return {
    id: task.id!,
    listId,
    title: task.title ?? '',
    status,
    importance,
    body: isHtml ? htmlToText(content) : content,
    bodyHtml: isHtml ? content : null,
    dueDate: graphToLocalDate(task.dueDateTime, tz),
    reminderAt: reminder ? reminder.toISOString() : null,
    isReminderOn: task.isReminderOn ?? false,
    recurrence: task.recurrence ?? null,
    categories: task.categories ?? [],
    hasAttachments: task.hasAttachments ?? false,
    createdDateTime: task.createdDateTime ?? new Date().toISOString(),
    lastModifiedDateTime: task.lastModifiedDateTime ?? new Date().toISOString(),
    completedDate: graphToLocalDate(task.completedDateTime, tz),
    steps: (task.checklistItems ?? []).map(fromGraphStep),
    linkedResources: (task.linkedResources ?? []).map(fromGraphLinkedResource),
    completed: status === 'completed' ? 1 : 0,
    important: importance === 'high' ? 1 : 0,
  }
}

// ---------- domain → Graph ----------

/**
 * Field-level PATCH body: only the properties present in `changes` are sent, so anything Woutist
 * doesn't model (or another client changed meanwhile) is left untouched.
 */
export function toGraphPatch(changes: TaskChanges, tz = userTimeZone()): GraphTodoTask {
  const patch: GraphTodoTask = {}
  if (changes.title !== undefined) patch.title = changes.title
  if (changes.status !== undefined) patch.status = changes.status
  if (changes.importance !== undefined) patch.importance = changes.importance
  if (changes.body !== undefined) patch.body = { content: changes.body, contentType: 'text' }
  if (changes.dueDate !== undefined) {
    patch.dueDateTime = changes.dueDate ? localDateToGraph(changes.dueDate, tz) : null
  }
  if (changes.reminderAt !== undefined) {
    patch.reminderDateTime = changes.reminderAt
      ? instantToGraph(new Date(changes.reminderAt), tz)
      : null
  }
  if (changes.isReminderOn !== undefined) patch.isReminderOn = changes.isReminderOn
  if (changes.recurrence !== undefined) patch.recurrence = changes.recurrence
  if (changes.categories !== undefined) patch.categories = changes.categories
  return patch
}

/** Apply changes to a local task record (optimistic update). */
export function applyChanges(task: Task, changes: TaskChanges): Task {
  const next: Task = { ...task, ...stripUndefined(changes) }
  if (changes.body !== undefined) next.bodyHtml = null
  if (changes.status !== undefined) {
    next.completed = changes.status === 'completed' ? 1 : 0
    if (changes.status === 'completed' && !task.completedDate) {
      // The user's calendar date, like Graph's completedDateTime read back in their zone.
      next.completedDate = todayLocal()
    }
    if (changes.status !== 'completed') next.completedDate = null
  }
  if (changes.importance !== undefined) next.important = changes.importance === 'high' ? 1 : 0
  next.lastModifiedDateTime = new Date().toISOString()
  return next
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

/** A new, not-yet-synced task with sensible defaults. */
export function newLocalTask(listId: string, title: string, changes: TaskChanges = {}): Task {
  const now = new Date().toISOString()
  const base: Task = {
    id: newTempId(),
    listId,
    title,
    status: 'notStarted',
    importance: 'normal',
    body: '',
    bodyHtml: null,
    dueDate: null,
    reminderAt: null,
    isReminderOn: false,
    recurrence: null,
    categories: [],
    hasAttachments: false,
    createdDateTime: now,
    lastModifiedDateTime: now,
    completedDate: null,
    steps: [],
    linkedResources: [],
    completed: 0,
    important: 0,
  }
  return { ...applyChanges(base, { title, ...changes }), lastModifiedDateTime: now }
}

/** Graph create body for a new task (only fields that differ from Graph defaults). */
export function toGraphCreate(task: Task, tz = userTimeZone()): GraphTodoTask {
  const changes: TaskChanges = { title: task.title }
  if (task.status !== 'notStarted') changes.status = task.status
  if (task.importance !== 'normal') changes.importance = task.importance
  if (task.body) changes.body = task.body
  if (task.dueDate) changes.dueDate = task.dueDate
  if (task.isReminderOn && task.reminderAt) {
    changes.reminderAt = task.reminderAt
    changes.isReminderOn = true
  }
  if (task.recurrence) changes.recurrence = task.recurrence
  if (task.categories.length) changes.categories = task.categories
  return toGraphPatch(changes, tz)
}
