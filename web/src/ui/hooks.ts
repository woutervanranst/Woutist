import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router'
import { useServices } from '../app/AppServices'
import { usePrefs } from '../app/prefs'
import type { Task, TodoList } from '../models/todo'
import { orderLists } from '../models/views'
import type { AttachmentRecord, CategoryRecord } from '../services/db'
import type { SyncStatus } from '../services/sync/syncEngine'

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

export function useAccountPrefs() {
  const { accountKey } = useServices()
  return usePrefs(accountKey)
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
