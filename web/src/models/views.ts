import type { Task, TodoList } from './todo'
import { addDays, dayOfWeek, todayLocal } from './time'

export type SmartListId = 'important' | 'planned' | 'all' | 'completed'

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

export function matchesSearch(task: Task, query: string): boolean {
  const q = norm(query.trim())
  if (!q) return false
  return (
    norm(task.title).includes(q) ||
    norm(task.body).includes(q) ||
    task.steps.some((s) => norm(s.displayName).includes(q)) ||
    task.categories.some((c) => norm(c).includes(q))
  )
}

export function isPlanned(task: Task): boolean {
  return task.dueDate !== null || (task.isReminderOn && task.reminderAt !== null)
}

/** Tasks belonging to a view. "open" are shown on top, "completed" in the collapsible section. */
export function tasksForView(view: ViewRef, tasks: Task[]): { open: Task[]; completed: Task[] } {
  let selected: Task[]
  switch (view.kind) {
    case 'list':
      selected = tasks.filter((t) => t.listId === view.listId)
      break
    case 'search':
      selected = tasks.filter((t) => matchesSearch(t, view.query))
      break
    case 'smart':
      switch (view.id) {
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

export function groupPlanned(
  tasks: Task[],
  today: string = todayLocal(),
): { group: PlannedGroup; tasks: Task[] }[] {
  const groups = new Map<PlannedGroup, Task[]>()
  const sorted = [...tasks].sort((a, b) => (plannedDate(a) ?? '').localeCompare(plannedDate(b) ?? ''))
  for (const task of sorted) {
    const date = plannedDate(task)
    if (!date) continue
    const g = plannedGroup(date, today)
    groups.set(g, [...(groups.get(g) ?? []), task])
  }
  const order: PlannedGroup[] = ['earlier', 'today', 'tomorrow', 'thisWeek', 'later']
  return order.filter((g) => groups.has(g)).map((g) => ({ group: g, tasks: groups.get(g)! }))
}

const IMPORTANCE_RANK = { high: 0, normal: 1, low: 2 } as const

/** The fields sorting reads; the Android widget sorts its snapshot tasks with the same rules. */
export type SortableTask = Pick<Task, 'createdDateTime' | 'title' | 'importance' | 'dueDate'>

export function sortTasks<T extends SortableTask>(tasks: T[], pref: SortPref): T[] {
  const dir = pref.dir === 'asc' ? 1 : -1
  const byCreatedDesc = (a: T, b: T) => b.createdDateTime.localeCompare(a.createdDateTime)
  const cmp: Record<SortKey, (a: T, b: T) => number> = {
    // Newest first, like Microsoft To Do's default "add to top".
    default: byCreatedDesc,
    createdDateTime: (a, b) => dir * a.createdDateTime.localeCompare(b.createdDateTime),
    title: (a, b) => dir * a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
    importance: (a, b) => dir * (IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance]),
    dueDate: (a, b) => {
      // Tasks without a due date always go last.
      if (!a.dueDate && !b.dueDate) return 0
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return dir * a.dueDate.localeCompare(b.dueDate)
    },
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
