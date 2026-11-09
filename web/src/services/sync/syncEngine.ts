import type { TodoTask as GraphTodoTask } from '@microsoft/microsoft-graph-types'
import {
  fromGraphList,
  fromGraphStep,
  fromGraphTask,
  isTempId,
  type Task,
  type TaskChanges,
  toGraphCreate,
  toGraphPatch,
} from '../../models/todo'
import { userTimeZone } from '../../models/time'
import type { OutboxEntry, WoutistDb } from '../db'
import { graphStatus, isNotFound, isTransient } from '../graphClient'
import type { TaskService } from '../taskService'

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error'

export interface SyncStatus {
  state: SyncState
  lastSyncAt: number | null
  pendingChanges: number
  error: string | null
}

export type SyncEvent = 'synced' | 'flushed'

const FULL_REFRESH_MS = 6 * 60 * 60 * 1000
const MAX_BACKOFF_MS = 5 * 60 * 1000
/** Above this many changed tasks, re-reading the whole list is cheaper than per-task reads. */
const PER_TASK_FETCH_LIMIT = 20
const PARALLEL_LISTS = 4

const EDITABLE: (keyof TaskChanges)[] = [
  'title',
  'status',
  'importance',
  'body',
  'dueDate',
  'reminderAt',
  'isReminderOn',
  'recurrence',
  'categories',
]

/**
 * Keeps the local IndexedDB copy and Microsoft Graph in sync:
 * - push: replays the outbox in order (FIFO), with backoff on transient failures
 * - pull: lists in full, tasks via delta (full refresh on first sync and every few hours)
 * Server state never overwrites an entity that still has local changes waiting to be pushed.
 */
export class SyncEngine {
  private status: SyncStatus = { state: 'idle', lastSyncAt: null, pendingChanges: 0, error: null }
  private statusListeners = new Set<(s: SyncStatus) => void>()
  private eventListeners = new Set<(e: SyncEvent) => void>()
  private syncPromise: Promise<void> | null = null
  /** What to sync once the running sync ends: everything, or just these lists. */
  private syncAgain: { all: true } | { all: false; lists: Set<string> } | null = null
  private flushPromise: Promise<void> | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private intervalTimer: ReturnType<typeof setInterval> | null = null
  private detach: (() => void) | null = null

  private readonly db: WoutistDb
  private readonly svc: TaskService
  private readonly tz: string

  constructor(db: WoutistDb, svc: TaskService, tz: string = userTimeZone()) {
    this.db = db
    this.svc = svc
    this.tz = tz
  }

  // ---------- observable status / events ----------

  getStatus = (): SyncStatus => this.status

  subscribe = (listener: (s: SyncStatus) => void): (() => void) => {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  on(listener: (e: SyncEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  private async setStatus(patch: Partial<SyncStatus>) {
    const pendingChanges = await this.db.outbox.count()
    this.status = { ...this.status, ...patch, pendingChanges }
    for (const l of this.statusListeners) l(this.status)
  }

  private emit(event: SyncEvent) {
    for (const l of this.eventListeners) l(event)
  }

  // ---------- lifecycle ----------

  /** Start background syncing: now, every 5 min while visible, on focus and when back online. */
  start(intervalMs = 5 * 60 * 1000): void {
    if (this.detach) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.sync()
    }
    const onOnline = () => void this.sync()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    this.intervalTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.sync()
    }, intervalMs)
    this.detach = () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
    void this.sync()
  }

  stop(): void {
    this.detach?.()
    this.detach = null
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    if (this.flushTimer) clearTimeout(this.flushTimer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.intervalTimer = this.flushTimer = this.retryTimer = null
  }

  /** Called by the repository after each local change: push soon (debounced). */
  requestFlush = (): void => {
    void this.setStatus({})
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush().then(() => this.emit('flushed'))
    }, 250)
  }

  // ---------- full sync ----------

  /**
   * Push pending changes, then pull: every list, or only `lists` (when a change notification names
   * them). Concurrent calls share one run plus one follow-up covering everything they asked for.
   */
  sync(options: { full?: boolean; lists?: readonly string[] } = {}): Promise<void> {
    if (this.syncPromise) {
      this.queueAgain(options.lists)
      return this.syncPromise
    }
    this.syncPromise = this.runSync(options).finally(() => {
      this.syncPromise = null
      const again = this.syncAgain
      this.syncAgain = null
      if (again) void this.sync(again.all ? {} : { lists: [...again.lists] })
    })
    return this.syncPromise
  }

  private queueAgain(lists: readonly string[] | undefined) {
    if (!lists) {
      this.syncAgain = { all: true }
    } else if (!this.syncAgain) {
      this.syncAgain = { all: false, lists: new Set(lists) }
    } else if (!this.syncAgain.all) {
      for (const id of lists) this.syncAgain.lists.add(id)
    }
  }

  private async runSync({ full = false, lists }: { full?: boolean; lists?: readonly string[] | undefined }): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await this.setStatus({ state: 'offline' })
      return
    }
    await this.setStatus({ state: 'syncing', error: null })
    try {
      await this.flush()
      const lastFull = (await this.db.getMeta<number>('lastFullSyncAt')) ?? 0
      const doFull = full || Date.now() - lastFull > FULL_REFRESH_MS
      const listIds = await this.pullLists()
      const pull = lists && !doFull ? await this.listsToPull(listIds, lists) : listIds
      await mapLimit(pull, PARALLEL_LISTS, (id) => this.pullTasks(id, doFull))
      if (doFull) {
        await this.pullCategories()
        await this.db.setMeta('lastFullSyncAt', Date.now())
      }
      await this.flush()
      const failed = await this.db.outbox.filter((op) => op.attempts > 0).count()
      await this.setStatus({
        state: failed ? 'offline' : 'idle',
        lastSyncAt: Date.now(),
      })
      this.emit('synced')
    } catch (error) {
      await this.setStatus({
        state: isTransient(error) ? 'offline' : 'error',
        error: describe(error),
      })
    }
  }

  // ---------- push ----------

  flush(): Promise<void> {
    if (!this.flushPromise) {
      this.flushPromise = this.runFlush().finally(() => {
        this.flushPromise = null
      })
    }
    return this.flushPromise
  }

  private async runFlush(): Promise<void> {
    for (;;) {
      const op = await this.db.outbox.orderBy('seq').first()
      if (!op) break
      if (op.nextAttemptAt > Date.now()) {
        this.scheduleRetry(op.nextAttemptAt)
        break
      }
      try {
        await this.execute(op)
        await this.db.outbox.delete(op.seq!)
      } catch (error) {
        if (isNotFound(error)) {
          await this.handleGone(op)
          await this.db.outbox.delete(op.seq!)
          continue
        }
        if (isTransient(error)) {
          const attempts = op.attempts + 1
          const nextAttemptAt = Date.now() + Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS)
          await this.db.outbox.update(op.seq!, { attempts, nextAttemptAt, lastError: describe(error) })
          this.scheduleRetry(nextAttemptAt)
          await this.setStatus({ state: 'offline', error: describe(error) })
          break
        }
        // Permanent rejection (400/403/409…): drop the change and restore the server's truth.
        await this.db.outbox.delete(op.seq!)
        await this.db.setMeta('lastRejected', { op, error: describe(error), at: Date.now() })
        await this.restoreFromServer(op)
        await this.setStatus({ error: `A change was rejected by Microsoft To Do: ${describe(error)}` })
      }
    }
    await this.setStatus({})
  }

  private scheduleRetry(at: number) {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = null
        void this.flush().then(() => this.emit('flushed'))
      },
      Math.max(0, at - Date.now()),
    )
  }

  private async execute(op: OutboxEntry): Promise<void> {
    const { db, svc } = this
    switch (op.type) {
      case 'list.create': {
        const local = await db.lists.get(op.listId)
        if (!local) return
        const created = await svc.createList(local.displayName)
        await this.remapList(op.listId, created.id!)
        const after = await db.lists.get(created.id!)
        if (!after) await svc.deleteList(created.id!) // deleted while being created
        else if (after.displayName !== local.displayName) {
          await svc.updateList(created.id!, { displayName: after.displayName })
        }
        return
      }
      case 'list.update':
        await svc.updateList(op.listId, { displayName: op.displayName })
        return
      case 'list.delete':
        await svc.deleteList(op.listId)
        return
      case 'task.create': {
        const local = await db.tasks.get(op.taskId)
        if (!local) return
        const created = await svc.createTask(op.listId, toGraphCreate(local, this.tz))
        await this.remapTask(op.taskId, created)
        const after = await db.tasks.get(created.id!)
        if (!after) {
          await svc.deleteTask(op.listId, created.id!) // deleted while being created
          return
        }
        const missed = diffEditable(local, after)
        if (Object.keys(missed).length) {
          await svc.updateTask(after.listId, after.id, toGraphPatch(missed, this.tz))
        }
        return
      }
      case 'task.update':
        await svc.updateTask(op.listId, op.taskId, toGraphPatch(op.changes, this.tz))
        return
      case 'task.delete':
        try {
          await svc.deleteTask(op.listId, op.taskId)
        } catch (error) {
          if (!isNotFound(error)) throw error
        }
        return
      case 'step.create': {
        const task = await db.tasks.get(op.taskId)
        const step = task?.steps.find((s) => s.id === op.stepId)
        if (!task || !step) return
        const created = await svc.createStep(op.listId, op.taskId, {
          displayName: step.displayName,
          isChecked: step.isChecked,
        })
        await this.remapStep(op.taskId, op.stepId, created.id!, created)
        const after = (await db.tasks.get(op.taskId))?.steps.find((s) => s.id === created.id)
        if (after && (after.displayName !== step.displayName || after.isChecked !== step.isChecked)) {
          await svc.updateStep(op.listId, op.taskId, created.id!, {
            displayName: after.displayName,
            isChecked: after.isChecked,
          })
        }
        return
      }
      case 'step.update':
        await svc.updateStep(op.listId, op.taskId, op.stepId, op.patch)
        return
      case 'step.delete':
        try {
          await svc.deleteStep(op.listId, op.taskId, op.stepId)
        } catch (error) {
          if (!isNotFound(error)) throw error
        }
        return
      case 'attachment.upload': {
        const record = await db.attachments.get(op.attachmentId)
        if (!record?.data) return
        const blob = new Blob([record.data], { type: record.contentType })
        await svc.uploadAttachment(op.listId, op.taskId, blob, record.name)
        await db.attachments.delete(op.attachmentId)
        await this.refreshAttachments(op.listId, op.taskId)
        return
      }
      case 'attachment.copy': {
        const blob = await svc.downloadAttachment(op.fromListId, op.fromTaskId, op.fromAttachmentId)
        await svc.uploadAttachment(op.listId, op.taskId, blob, op.name)
        await db.attachments.delete(op.fromAttachmentId)
        await this.refreshAttachments(op.listId, op.taskId)
        return
      }
      case 'attachment.delete':
        try {
          await svc.deleteAttachment(op.listId, op.taskId, op.attachmentId)
        } catch (error) {
          if (!isNotFound(error)) throw error
        }
        return
    }
  }

  /** The entity an op targets no longer exists on the server: drop it locally too. */
  private async handleGone(op: OutboxEntry): Promise<void> {
    const { db } = this
    if (!op.taskId) {
      await db.transaction('rw', db.lists, db.tasks, db.meta, async () => {
        await db.tasks.where('listId').equals(op.listId).delete()
        await db.lists.delete(op.listId)
        await db.meta.delete(`delta:tasks:${op.listId}`)
      })
      return
    }
    if (op.type === 'step.update') {
      const task = await this.svc.getTask(op.listId, op.taskId)
      if (task) await this.storeServerTask(task, op.listId)
      else await db.tasks.delete(op.taskId)
      return
    }
    await db.tasks.delete(op.taskId)
    await db.outbox.where('taskId').equals(op.taskId).delete()
  }

  private async restoreFromServer(op: OutboxEntry): Promise<void> {
    if (!op.taskId) {
      await this.pullLists()
      return
    }
    if (isTempId(op.taskId)) {
      await this.db.tasks.delete(op.taskId)
      return
    }
    const task = await this.svc.getTask(op.listId, op.taskId)
    if (task) await this.storeServerTask(task, op.listId)
    else await this.db.tasks.delete(op.taskId)
  }

  // ---------- id remapping ----------

  private async remapList(tempId: string, realId: string) {
    const { db } = this
    await db.transaction('rw', [db.lists, db.tasks, db.outbox, db.attachments, db.meta], async () => {
      const local = await db.lists.get(tempId)
      if (local) {
        await db.lists.delete(tempId)
        await db.lists.put({ ...local, id: realId })
      }
      await db.tasks.where('listId').equals(tempId).modify((t) => {
        t.listId = realId
      })
      await db.outbox.where('listId').equals(tempId).modify((o) => {
        o.listId = realId
      })
      await db.attachments.filter((a) => a.listId === tempId).modify((a) => {
        a.listId = realId
      })
      await db.setMeta(`alias:${tempId}`, realId)
    })
  }

  private async remapTask(tempId: string, created: GraphTodoTask) {
    const { db } = this
    const realId = created.id!
    await db.transaction('rw', [db.tasks, db.outbox, db.attachments, db.meta], async () => {
      const local = await db.tasks.get(tempId)
      if (local) {
        await db.tasks.delete(tempId)
        await db.tasks.put({
          ...local,
          id: realId,
          createdDateTime: created.createdDateTime ?? local.createdDateTime,
          lastModifiedDateTime: created.lastModifiedDateTime ?? local.lastModifiedDateTime,
        })
      }
      await db.outbox.where('taskId').equals(tempId).modify((o) => {
        o.taskId = realId
      })
      await db.attachments.where('taskId').equals(tempId).modify((a) => {
        a.taskId = realId
      })
      await db.setMeta(`alias:${tempId}`, realId)
    })
  }

  private async remapStep(taskId: string, tempId: string, realId: string, created: Parameters<typeof fromGraphStep>[0]) {
    const { db } = this
    await db.transaction('rw', [db.tasks, db.outbox], async () => {
      const task = await db.tasks.get(taskId)
      if (task) {
        const server = fromGraphStep(created)
        await db.tasks.update(taskId, {
          steps: task.steps.map((s) => (s.id === tempId ? { ...s, id: realId, createdDateTime: server.createdDateTime } : s)),
        })
      }
      await db.outbox
        .filter((o) => 'stepId' in o && o.stepId === tempId)
        .modify((o) => {
          if ('stepId' in o) o.stepId = realId
        })
    })
  }

  // ---------- pull ----------

  /** The requested lists that exist, plus any list not read yet (created elsewhere since the last sync). */
  private async listsToPull(listIds: string[], requested: readonly string[]): Promise<string[]> {
    const wanted = new Set(requested)
    const read = await Promise.all(listIds.map((id) => this.db.getMeta<string>(`delta:tasks:${id}`)))
    return listIds.filter((id, i) => wanted.has(id) || !read[i])
  }

  /** Ids of lists/tasks that still have local changes waiting to be pushed. */
  private async pendingIds(): Promise<{ lists: Set<string>; tasks: Set<string> }> {
    const ops = await this.db.outbox.toArray()
    return {
      lists: new Set(ops.filter((o) => o.type.startsWith('list.')).map((o) => o.listId)),
      tasks: new Set(ops.flatMap((o) => (o.taskId ? [o.taskId] : []))),
    }
  }

  async pullLists(): Promise<string[]> {
    const server = await this.svc.getLists()
    const pending = await this.pendingIds()
    const serverIds = new Set(server.map((l) => l.id!))
    const { db } = this
    await db.transaction('rw', [db.lists, db.tasks, db.attachments, db.meta], async () => {
      for (const [i, list] of server.entries()) {
        if (pending.lists.has(list.id!)) continue
        await db.lists.put(fromGraphList(list, i))
      }
      const localIds = (await db.lists.toCollection().primaryKeys()) as string[]
      for (const id of localIds) {
        if (serverIds.has(id) || isTempId(id) || pending.lists.has(id)) continue
        await db.tasks.where('listId').equals(id).delete()
        await db.attachments.filter((a) => a.listId === id).delete()
        await db.lists.delete(id)
        await db.meta.delete(`delta:tasks:${id}`)
      }
    })
    return server.map((l) => l.id!)
  }

  async pullTasks(listId: string, full = false): Promise<void> {
    const key = `delta:tasks:${listId}`
    const link = full ? undefined : await this.db.getMeta<string>(key)
    if (!link) {
      // Initial round: every task (with steps) plus a deltaLink to continue from.
      const initial = await this.svc.tasksDelta(listId)
      await this.replaceListTasks(listId, await this.withSteps(listId, initial.changed))
      await this.db.setMeta(key, initial.deltaLink)
      return
    }

    let delta
    try {
      delta = await this.svc.tasksDelta(listId, link)
    } catch (error) {
      const status = graphStatus(error)
      if (status === 410 || status === 400) {
        // Delta token expired or invalid: start over with a full read.
        await this.db.meta.delete(key)
        return this.pullTasks(listId, true)
      }
      throw error
    }

    const pending = await this.pendingIds()
    const fresh = await this.withSteps(
      listId,
      delta.changed.filter((t) => !pending.tasks.has(t.id!)),
    )

    const { db } = this
    await db.transaction('rw', [db.tasks, db.attachments, db.outbox, db.meta], async () => {
      for (const t of fresh) await db.tasks.put(this.mergeServerTask(t, listId, await db.tasks.get(t.id!)))
      for (const id of delta.removedIds) {
        // Deleted on the server: a delete wins over unsynced local edits.
        await db.tasks.delete(id)
        await db.attachments.where('taskId').equals(id).delete()
        await db.outbox.where('taskId').equals(id).delete()
      }
      await db.setMeta(key, delta.deltaLink)
    })
  }

  /**
   * Delta is requested with `$expand=checklistItems,linkedResources`, so tasks that have steps arrive with them.
   * Graph omits the key for a task without steps (verified, see docs/graph-api-notes.md), so a missing
   * `checklistItems` means "no steps" and costs nothing. The exception is a task whose local copy has synced
   * steps: it may have lost them elsewhere, or the deltaLink may have lost its `$expand`, so only those tasks
   * are re-read (one by one, or the whole list when there are many).
   */
  private async withSteps(listId: string, tasks: GraphTodoTask[]): Promise<GraphTodoTask[]> {
    const stepless = tasks.filter((t) => !Array.isArray(t.checklistItems)).map((t) => t.id!)
    if (stepless.length === 0) return tasks
    const local = await this.db.tasks.bulkGet(stepless)
    const stale = stepless.filter((_, i) => local[i]?.steps.some((s) => !isTempId(s.id)))
    if (stale.length === 0) return tasks
    let refetched: GraphTodoTask[]
    if (stale.length > PER_TASK_FETCH_LIMIT) {
      const wanted = new Set(stale)
      refetched = (await this.svc.getTasks(listId)).filter((t) => wanted.has(t.id!))
    } else {
      refetched = (await mapLimit(stale, 4, (id) => this.svc.getTask(listId, id))).filter(
        (t): t is GraphTodoTask => t !== null,
      )
    }
    const staleIds = new Set(stale)
    const byId = new Map(refetched.map((t) => [t.id!, t]))
    // A re-read task that is gone (404) is dropped; the others keep what delta gave us.
    return tasks.flatMap((t) => (staleIds.has(t.id!) ? (byId.has(t.id!) ? [byId.get(t.id!)!] : []) : [t]))
  }

  private async replaceListTasks(listId: string, server: GraphTodoTask[]) {
    const pending = await this.pendingIds()
    const serverIds = new Set(server.map((t) => t.id!))
    const { db } = this
    await db.transaction('rw', [db.tasks, db.attachments], async () => {
      for (const t of server) {
        if (pending.tasks.has(t.id!)) continue
        await db.tasks.put(this.mergeServerTask(t, listId, await db.tasks.get(t.id!)))
      }
      const localIds = (await db.tasks.where('listId').equals(listId).primaryKeys()) as string[]
      for (const id of localIds) {
        if (serverIds.has(id) || isTempId(id) || pending.tasks.has(id)) continue
        await db.tasks.delete(id)
        await db.attachments.where('taskId').equals(id).delete()
      }
    })
  }

  /** Server task → local record, keeping steps that haven't been pushed yet. */
  private mergeServerTask(server: GraphTodoTask, listId: string, local: Task | undefined): Task {
    const mapped = fromGraphTask(server, listId, this.tz)
    if (local) {
      const unsyncedSteps = local.steps.filter((s) => isTempId(s.id))
      if (unsyncedSteps.length) mapped.steps = [...mapped.steps, ...unsyncedSteps]
    }
    return mapped
  }

  private async storeServerTask(task: GraphTodoTask, listId: string) {
    await this.db.tasks.put(this.mergeServerTask(task, listId, await this.db.tasks.get(task.id!)))
  }

  async pullCategories(): Promise<void> {
    const categories = await this.svc.getCategories()
    const { db } = this
    await db.transaction('rw', db.categories, async () => {
      await db.categories.clear()
      await db.categories.bulkPut(
        categories.map((c) => ({ id: c.id, displayName: c.displayName ?? '', color: c.color ?? 'none' })),
      )
    })
  }

  /** Load attachment metadata for a task (called when its details are opened). */
  async refreshAttachments(listId: string, taskId: string): Promise<void> {
    if (isTempId(taskId)) return
    const server = await this.svc.getAttachments(listId, taskId)
    const { db } = this
    await db.transaction('rw', db.attachments, async () => {
      const pendingUploads = await db.attachments
        .where('taskId')
        .equals(taskId)
        .filter((a) => isTempId(a.id) || a.data !== undefined)
        .toArray()
      await db.attachments.where('taskId').equals(taskId).delete()
      await db.attachments.bulkPut([
        ...server.map((a) => ({
          id: a.id!,
          listId,
          taskId,
          name: a.name ?? 'attachment',
          contentType: a.contentType ?? 'application/octet-stream',
          size: a.size ?? 0,
          lastModifiedDateTime: a.lastModifiedDateTime ?? new Date().toISOString(),
        })),
        ...pendingUploads,
      ])
    })
  }

  downloadAttachment(listId: string, taskId: string, attachmentId: string): Promise<Blob> {
    return this.svc.downloadAttachment(listId, taskId, attachmentId)
  }
}

function diffEditable(before: Task, after: Task): TaskChanges {
  const out: Record<string, unknown> = {}
  for (const key of EDITABLE) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) out[key] = after[key]
  }
  return out as TaskChanges
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}
