import type { Task, TodoList } from './todo'
import { addDays, dayOfWeek, todayLocal } from './time'

export type SmartListId = 'today' | 'important' | 'planned' | 'all' | 'completed'

export type ViewRef =
  | { kind: 'smart'; id: SmartListId }
  | { kind: 'list'; listId: string }
  | { kind: 'search'; query: string }

export type SortKey = 'default' | 'importance' | 'dueDate' | 'title' | 'createdDateTime'
export type SortDir = 'asc' | 'desc'
export interface SortPref {
  key: SortKey
  dir: SortDir
}

export const SMART_LISTS: { id: SmartListId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'important', label: 'Important' },
  { id: 'planned', label: 'Planned' },
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Completed' },
]

export function viewKey(view: ViewRef): string {
  if (view.kind === 'smart') return `smart:${view.id}`
  if (view.kind === 'list') return `list:${view.listId}`
  return 'search'
}

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '')

const searchTexts = new WeakMap<Task, string>()

/**
 * A task's searchable text (title, notes, steps, categories), normalized once per task object.
 * Stored tasks are replaced on change, never mutated, so a cached text can't go stale; one field per
 * line, so a query (which has no line breaks) never matches across fields.
 */
export function searchText(task: Task): string {
  let text = searchTexts.get(task)
  if (text === undefined) {
    text = norm([task.title, task.body, ...task.steps.map((s) => s.displayName), ...task.categories].join('\n'))
    searchTexts.set(task, text)
  }
  return text
}

export function matchesSearch(task: Task, query: string): boolean {
  const q = norm(query.trim())
  return q !== '' && searchText(task).includes(q)
}

export function isPlanned(task: Task): boolean {
  return task.dueDate !== null || (task.isReminderOn && task.reminderAt !== null)
}

/** Due or overdue on `today`: filed under today or earlier in Planned (see `plannedDate`). */
export function isDueBy(task: Task, today: string): boolean {
  const date = plannedDate(task)
  return date !== null && date <= today
}

/**
 * Tasks belonging to a view. "open" are shown on top, "completed" in the collapsible section.
 * `today` (the user's date) decides what Today shows.
 */
export function tasksForView(view: ViewRef, tasks: Task[], today: string = todayLocal()): { open: Task[]; completed: Task[] } {
  let selected: Task[]
  switch (view.kind) {
    case 'list':
      selected = tasks.filter((t) => t.listId === view.listId)
      break
    case 'search': {
      const q = norm(view.query.trim())
      selected = q ? tasks.filter((t) => searchText(t).includes(q)) : []
      break
    }
    case 'smart':
      switch (view.id) {
        case 'today':
          return {
            open: tasks.filter((t) => !t.completed && isDueBy(t, today)),
            completed: tasks.filter((t) => t.completed && t.completedDate === today),
          }
        case 'important':
          return { open: tasks.filter((t) => t.important && !t.completed), completed: [] }
        case 'planned':
          return { open: tasks.filter((t) => !t.completed && isPlanned(t)), completed: [] }
        case 'all':
          selected = tasks
          break
        case 'completed':
          return { open: [], completed: tasks.filter((t) => t.completed) }
      }
  }
  return {
    open: selected.filter((t) => !t.completed),
    completed: selected.filter((t) => t.completed),
  }
}

/** The date a planned task is filed under: its due date, else its reminder date. */
export function plannedDate(task: Task, tz?: string): string | null {
  if (task.dueDate) return task.dueDate
  if (task.isReminderOn && task.reminderAt) return todayLocal(new Date(task.reminderAt), tz)
  return null
}

export type PlannedGroup = 'earlier' | 'today' | 'tomorrow' | 'thisWeek' | 'later'
export const PLANNED_GROUP_LABELS: Record<PlannedGroup, string> = {
  earlier: 'Earlier',
  today: 'Today',
  tomorrow: 'Tomorrow',
  thisWeek: 'This week',
  later: 'Later',
}

export function plannedGroup(date: string, today: string): PlannedGroup {
  if (date < today) return 'earlier'
  if (date === today) return 'today'
  if (date === addDays(today, 1)) return 'tomorrow'
  // Rest of the current week (weeks end on Sunday).
  const daysLeftInWeek = (7 - dayOfWeek(today)) % 7
  if (date <= addDays(today, daysLeftInWeek)) return 'thisWeek'
  return 'later'
}

/**
 * Planned tasks grouped by when they're due. Within a day the order is the one the tasks came in, or,
 * with `byReminder`, earliest reminder first (tasks without one last).
 */
export function groupPlanned(
  tasks: Task[],
  today: string = todayLocal(),
  byReminder = false,
): { group: PlannedGroup; tasks: Task[] }[] {
  const groups = new Map<PlannedGroup, Task[]>()
  const sorted = [...tasks].sort(
    (a, b) =>
      (plannedDate(a) ?? '').localeCompare(plannedDate(b) ?? '') ||
      (byReminder ? compareReminders(reminderOf(a), reminderOf(b)) : 0),
  )
  for (const task of sorted) {
    const date = plannedDate(task)
    if (!date) continue
    const g = plannedGroup(date, today)
    groups.set(g, [...(groups.get(g) ?? []), task])
  }
  const order: PlannedGroup[] = ['earlier', 'today', 'tomorrow', 'thisWeek', 'later']
  return order.filter((g) => groups.has(g)).map((g) => ({ group: g, tasks: groups.get(g)! }))
}

/** The first `limit` tasks of grouped tasks, in order, dropping groups that end up empty. */
export function limitGroups<G extends { tasks: Task[] }>(groups: G[], limit: number): G[] {
  const result: G[] = []
  let left = limit
  for (const g of groups) {
    if (left <= 0) break
    result.push(g.tasks.length <= left ? g : { ...g, tasks: g.tasks.slice(0, left) })
    left -= g.tasks.length
  }
  return result
}

const IMPORTANCE_RANK = { high: 0, normal: 1, low: 2 } as const

/**
 * The fields sorting reads; the Android widget sorts its snapshot tasks with the same rules. A snapshot
 * task has no `isReminderOn`: its `reminderAt` is already null when the reminder is off.
 */
export type SortableTask = Pick<Task, 'createdDateTime' | 'title' | 'importance' | 'dueDate' | 'reminderAt'> & {
  isReminderOn?: boolean
}

/** When a task's reminder fires (ISO instant), or null when it has none switched on. */
export function reminderOf(task: Pick<SortableTask, 'reminderAt' | 'isReminderOn'>): string | null {
  return task.isReminderOn === false ? null : task.reminderAt
}

/** Earliest reminder first; tasks without a reminder go last. */
export function compareReminders(a: string | null, b: string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  return a.localeCompare(b)
}

/** Tasks without a due date go last, whatever the direction. */
function compareDueDates(a: string | null, b: string | null, dir: 1 | -1): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  return dir * a.localeCompare(b)
}

/**
 * Sorts tasks by `pref`. `today` is the user's date: by default a task that has a reminder but no due
 * date counts as due today, so one whose due date was removed by mistake doesn't sink out of sight.
 */
export function sortTasks<T extends SortableTask>(tasks: T[], pref: SortPref, today: string = todayLocal()): T[] {
  const dir = pref.dir === 'asc' ? 1 : -1
  const byCreatedDesc = (a: T, b: T) => b.createdDateTime.localeCompare(a.createdDateTime)
  const cmp: Record<SortKey, (a: T, b: T) => number> = {
    // Due date (earliest first, undated last), then reminder time, then newest first.
    default: (a, b) =>
      compareDueDates(a.dueDate ?? (reminderOf(a) ? today : null), b.dueDate ?? (reminderOf(b) ? today : null), 1) ||
      compareReminders(reminderOf(a), reminderOf(b)),
    createdDateTime: (a, b) => dir * a.createdDateTime.localeCompare(b.createdDateTime),
    title: (a, b) => dir * a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
    importance: (a, b) => dir * (IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance]),
    dueDate: (a, b) => compareDueDates(a.dueDate, b.dueDate, dir),
  }
  return [...tasks].sort((a, b) => cmp[pref.key](a, b) || byCreatedDesc(a, b))
}

/** Lists in sidebar order: Tasks first, then flagged email, then the rest in Graph order. */
export function orderLists(lists: TodoList[]): TodoList[] {
  const rank = (l: TodoList) => (l.wellknownListName === 'defaultList' ? 0 : l.wellknownListName === 'flaggedEmails' ? 1 : 2)
  return [...lists].sort((a, b) => rank(a) - rank(b) || a.sortIndex - b.sortIndex)
}

/** Split a leading emoji off a list name, Microsoft To Do style ("🛒 Groceries"). */
export function splitListEmoji(name: string): { emoji: string | null; label: string } {
  const trimmed = name.trim()
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const first = segmenter.segment(trimmed)[Symbol.iterator]().next().value?.segment ?? ''
  if (first && /\p{Extended_Pictographic}/u.test(first)) {
    const label = trimmed.slice(first.length).trim()
    return { emoji: first, label: label || trimmed }
  }
  return { emoji: null, label: trimmed }
}
