import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router'
import { useServices } from '../app/AppServices'
import { type Prefs, usePrefs } from '../app/prefs'
import { useMediaQuery } from '../app/theme'
import type { DateSettings } from '../models/quickDates'
import { todayLocal } from '../models/time'
import type { Task, TodoList } from '../models/todo'
import { type StartPage, orderLists } from '../models/views'
import type { AttachmentRecord, CategoryRecord } from '../services/db'
import type { LiveState } from '../services/sync/liveUpdates'
import type { SyncStatus } from '../services/sync/syncEngine'
import { type SyncDescription, describeSync } from './syncText'

export function useLists(): TodoList[] | undefined {
  const { db } = useServices()
  return useLiveQuery(async () => orderLists(await db.lists.toArray()), [db])
}

export function useAllTasks(): Task[] | undefined {
  const { db } = useServices()
  return useLiveQuery(() => db.tasks.toArray(), [db])
}

export function useTask(taskId: string | null): Task | undefined | null {
  const { db } = useServices()
  return useLiveQuery(async () => (taskId ? ((await db.tasks.get(taskId)) ?? null) : null), [db, taskId])
}

/** Ids of tasks with changes not yet pushed to Microsoft To Do. */
export function usePendingTaskIds(): Set<string> {
  const { db } = useServices()
  const ids = useLiveQuery(async () => {
    const ops = await db.outbox.toArray()
    return new Set(ops.flatMap((o) => (o.taskId ? [o.taskId] : [])))
  }, [db])
  return ids ?? new Set()
}

export function useCategories(): CategoryRecord[] {
  const { db } = useServices()
  return useLiveQuery(() => db.categories.toArray(), [db]) ?? []
}

export function useAttachments(taskId: string | null): AttachmentRecord[] {
  const { db } = useServices()
  return (
    useLiveQuery(
      async () => (taskId ? db.attachments.where('taskId').equals(taskId).toArray() : []),
      [db, taskId],
    ) ?? []
  )
}

export function useSyncStatus(): SyncStatus {
  const { engine } = useServices()
  return useSyncExternalStore(engine.subscribe, engine.getStatus)
}

/** Whether this device gets near-instant sync signals. */
export function useLiveUpdates(): LiveState {
  const { live } = useServices()
  return useSyncExternalStore(live.subscribe, live.getState)
}

/**
 * What the sync icon and Settings › Sync say right now. "Up to date" lapses by itself (after 5 minutes without
 * live updates), so this looks again at that moment and whenever the app returns to the foreground (timers
 * sleep in the background).
 */
export function useSyncDescription(): { status: SyncStatus; live: LiveState; sync: SyncDescription; now: number } {
  const status = useSyncStatus()
  const live = useLiveUpdates()
  const [seen, setNow] = useState(() => Date.now())
  // A sync that ended after the time last looked at is, of course, in the past.
  const now = Math.max(seen, status.lastSyncAt ?? 0)
  const sync = describeSync(status, live, now)
  const { lapsesAt } = sync
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    document.addEventListener('visibilitychange', refresh)
    // setTimeout can't wait longer than ~24 days.
    const timer = lapsesAt === null ? null : setTimeout(refresh, Math.min(Math.max(lapsesAt - Date.now(), 0) + 50, 2 ** 31 - 1))
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      if (timer) clearTimeout(timer)
    }
  }, [lapsesAt])
  return { status, live, sync, now }
}

export function useAccountPrefs() {
  const { accountKey } = useServices()
  return usePrefs(accountKey)
}

/** Marks a change to a synced setting as unsaved. */
function stampSynced(p: Prefs): Pick<Prefs, 'syncedUpdatedAt' | 'syncedDirty'> {
  // Last writer wins across devices, so a change must never look older than the one it replaces.
  const previous = p.syncedUpdatedAt ? Date.parse(p.syncedUpdatedAt) : 0
  return { syncedUpdatedAt: new Date(Math.max(Date.now(), previous + 1)).toISOString(), syncedDirty: true }
}

/**
 * Quick dates and reminder times. Changes are marked for saving to the Microsoft account, so every
 * device gets them (services/settingsSync.ts).
 */
export function useDateSettings(): [DateSettings, (fn: (s: DateSettings) => DateSettings) => void] {
  const [prefs, update] = useAccountPrefs()
  const set = useCallback(
    (fn: (s: DateSettings) => DateSettings) =>
      update((p) => {
        const dates = fn(p.dates)
        return dates === p.dates ? p : { ...p, dates, ...stampSynced(p) }
      }),
    [update],
  )
  return [prefs.dates, set]
}

/** Where the app opens. Changes are saved to the Microsoft account, so every device opens there. */
export function useStartPage(): [StartPage, (page: StartPage) => void] {
  const [prefs, update] = useAccountPrefs()
  const set = useCallback(
    (startPage: StartPage) =>
      update((p) => (startPage === p.startPage ? p : { ...p, startPage, ...stampSynced(p) })),
    [update],
  )
  return [prefs.startPage, set]
}

function subscribeToday(onChange: () => void): () => void {
  // Checked every minute and when the app comes back to the foreground (timers sleep in the background).
  const timer = setInterval(onChange, 60_000)
  document.addEventListener('visibilitychange', onChange)
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onChange)
  }
}

/** The user's date (`YYYY-MM-DD`); re-renders when it changes at midnight. */
export function useToday(): string {
  return useSyncExternalStore(subscribeToday, () => todayLocal())
}

/** Phone-sized layout: the details pane replaces the list and pickers open as bottom sheets. */
export function useCompactLayout(): boolean {
  return !useMediaQuery('(min-width: 900px)')
}

/**
 * The task open in the details pane lives in the `?task=` query parameter. When a task created
 * offline is synced it gets a new id; this follows the alias so the pane stays open.
 */
export function useSelectedTask(): [string | null, (taskId: string | null) => void] {
  const { db } = useServices()
  const [params, setParams] = useSearchParams()
  const taskId = params.get('task')

  const select = useCallback(
    (id: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (id) next.set('task', id)
          else next.delete('task')
          return next
        },
        { replace: Boolean(id && taskId) },
      )
    },
    [setParams, taskId],
  )

  const alias = useLiveQuery(async () => {
    if (!taskId || (await db.tasks.get(taskId))) return null
    return (await db.getMeta<string>(`alias:${taskId}`)) ?? null
  }, [db, taskId])

  useEffect(() => {
    if (alias) select(alias)
  }, [alias, select])

  return [taskId, select]
}

/** Whether an open task has a reminder still ahead (the Android app only nags about reminder settings then). */
export function useHasUpcomingReminders(): boolean {
  const { db } = useServices()
  const count = useLiveQuery(
    () =>
      db.tasks
        .filter((t) => t.isReminderOn && !t.completed && t.reminderAt !== null && Date.parse(t.reminderAt) > Date.now())
        .count(),
    [db],
  )
  return (count ?? 0) > 0
}
