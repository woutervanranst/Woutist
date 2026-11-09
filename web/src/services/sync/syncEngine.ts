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
import { sameTask, sameTaskContent } from './taskDiff'
import { SYNC_LOG_RETENTION_MS, type SyncLogEntry, type SyncReason, strongerReason } from './syncTypes'

export type { SyncLogEntry, SyncReason, SyncResult } from './syncTypes'

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error'

/**
 * How far a running sync is. The quick pass counts lists; the full check counts tasks (the total is an
 * estimate from the local copy, and grows when more arrive). `total` 0 means not known yet.
 */
export interface SyncProgress {
  phase: 'changes' | 'full'
  done: number
  total: number
}

export interface SyncStatus {
  state: SyncState
  lastSyncAt: number | null
  /** When everything was last checked (not only what changed). */
  lastFullSyncAt: number | null
  pendingChanges: number
  error: string | null
  progress: SyncProgress | null
  /** Why the running sync was started; null when none is running. */
  reason: SyncReason | null
}

export interface SyncOptions {
  reason: SyncReason
  /** Only these lists (a change notification names them). Ignored when a full check is due. */
  lists?: readonly string[]
}

export type SyncEvent = 'synced' | 'flushed'

/** What a sync run did (the same record as its log entry). */
export type SyncOutcome = Omit<SyncLogEntry, 'id'>

const FULL_REFRESH_MS = 6 * 60 * 60 * 1000
/** A safety cap on the log; the 24 hours it keeps are what normally bounds it. */
const LOG_LIMIT = 500
const PROGRESS_INTERVAL_MS = 100
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
  private status: SyncStatus = {
    state: 'idle',
    lastSyncAt: null,
    lastFullSyncAt: null,
    pendingChanges: 0,
    error: null,
    progress: null,
    reason: null,
  }
  private statusListeners = new Set<(s: SyncStatus) => void>()
  private eventListeners = new Set<(e: SyncEvent) => void>()
  private syncPromise: Promise<SyncOutcome> | null = null
  /** What to sync once the running sync ends: everything, or just these lists; with the strongest reason asked for. */
  private syncAgain: { lists: Set<string> | null; reason: SyncReason } | null = null
  private loading: Promise<void> | null = null
  /** Outbox operations completed so far (a run reports the difference). */
  private opsCompleted = 0
  private lastEmitAt = 0
  private progressTimer: ReturnType<typeof setTimeout> | null = null
  private flushPromise: Promise<void> | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private intervalTimer: ReturnType<typeof setInterval> | null = null
  private detach: (() => void) | null = null

  private readonly db: WoutistDb
  private readonly svc: TaskService
  private readonly tz: string
  private readonly progressIntervalMs: number

  constructor(
    db: WoutistDb,
    svc: TaskService,
    tz: string = userTimeZone(),
    options: { progressIntervalMs?: number } = {},
  ) {
    this.db = db
    this.svc = svc
    this.tz = tz
    this.progressIntervalMs = options.progressIntervalMs ?? PROGRESS_INTERVAL_MS
  }

  /** Reads when the last (full) sync happened, so the status is right before the first sync of this session ends. */
  load(): Promise<void> {
    this.loading ??= (async () => {
      try {
        const [lastSyncAt, lastFullSyncAt] = await Promise.all([
          this.db.getMeta<number>('lastSyncAt'),
          this.db.getMeta<number>('lastFullSyncAt'),
        ])
        await this.setStatus({
          lastSyncAt: this.status.lastSyncAt ?? lastSyncAt ?? null,
          lastFullSyncAt: this.status.lastFullSyncAt ?? lastFullSyncAt ?? null,
        })
      } catch (error) {
        console.warn('Reading the last sync time failed', error)
      }
    })()
    return this.loading
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
    this.notify()
  }

  private notify() {
    if (this.progressTimer) clearTimeout(this.progressTimer)
    this.progressTimer = null
    this.lastEmitAt = Date.now()
    for (const l of this.statusListeners) l(this.status)
  }

  /** Progress changes come in fast (every page): the status changes at once, listeners hear about it at most every 100 ms. */
  private setProgress(progress: SyncProgress) {
    this.status = { ...this.status, progress }
    const wait = this.progressIntervalMs - (Date.now() - this.lastEmitAt)
    if (wait <= 0) this.notify()
    else this.progressTimer ??= setTimeout(() => this.notify(), wait)
  }

  private emit(event: SyncEvent) {
    for (const l of this.eventListeners) l(event)
  }

  // ---------- lifecycle ----------

  /** Start background syncing: now, every 5 min while visible, on focus and when back online. */
  start(intervalMs = 5 * 60 * 1000): void {
    if (this.detach) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.sync({ reason: 'visible' })
    }
    const onOnline = () => void this.sync({ reason: 'online' })
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    this.intervalTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.sync({ reason: 'interval' })
    }, intervalMs)
    this.detach = () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
    void this.load()
    void this.sync({ reason: 'startup' })
  }

  stop(): void {
    this.detach?.()
    this.detach = null
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    if (this.flushTimer) clearTimeout(this.flushTimer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.progressTimer) clearTimeout(this.progressTimer)
    this.intervalTimer = this.flushTimer = this.retryTimer = this.progressTimer = null
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
   * Push pending changes, then pull. The quick pass comes first: what changed in every list, or only in
   * `lists` (when a change notification names them). When a full check is due (every 6 hours, the first
   * sync) or asked for, it follows as a second phase. Concurrent calls share the running sync plus one
   * follow-up covering everything they asked for, under the most significant reason among them.
   * Resolves with what the run did.
   */
  sync(options: SyncOptions): Promise<SyncOutcome> {
    if (this.syncPromise) {
      this.queueAgain(options)
      return this.syncPromise
    }
    this.syncPromise = this.runSync(options).finally(() => {
      this.syncPromise = null
      const again = this.syncAgain
      this.syncAgain = null
      if (again) void this.sync({ reason: again.reason, ...(again.lists ? { lists: [...again.lists] } : {}) })
    })
    return this.syncPromise
  }

  private queueAgain({ reason, lists }: SyncOptions) {
    const queued = this.syncAgain
    if (!queued) {
      this.syncAgain = { reason, lists: lists ? new Set(lists) : null }
      return
    }
    queued.reason = strongerReason(queued.reason, reason)
    if (!lists) queued.lists = null
    else if (queued.lists) for (const id of lists) queued.lists.add(id)
  }

  private async runSync({ reason, lists }: SyncOptions): Promise<SyncOutcome> {
    await this.load()
    const startedAt = Date.now()
    const outcome: SyncOutcome = {
      startedAt,
      endedAt: startedAt,
      reason,
      full: false,
      result: 'ok',
      lists: [],
      changesMs: 0,
      fullCheck: null,
      sent: 0,
      requests: 0,
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await this.setStatus({ state: 'offline' })
      return this.finish({ ...outcome, result: 'offline', error: 'No connection' })
    }
    const requests0 = this.svc.requestCount
    const sent0 = this.opsCompleted
    await this.setStatus({ state: 'syncing', error: null, reason, progress: { phase: 'changes', done: 0, total: 0 } })
    try {
      await this.flush()
      const lastFull = (await this.db.getMeta<number>('lastFullSyncAt')) ?? 0
      const doFull = reason === 'manual-full' || Date.now() - lastFull > FULL_REFRESH_MS
      outcome.full = doFull
      let lastFullSyncAt = this.status.lastFullSyncAt

      // Phase 1, quick: what changed, in every list that is due (a list without a delta link is read in full).
      const listIds = await this.pullLists()
      const pull = lists && !doFull ? await this.listsToPull(listIds, lists) : listIds
      const names = new Map((await this.db.lists.bulkGet(pull)).map((l) => [l?.id, l?.displayName]))
      const readInFull = new Set<string>()
      let listsDone = 0
      this.setProgress({ phase: 'changes', done: 0, total: pull.length })
      outcome.lists = await mapLimit(pull, PARALLEL_LISTS, async (id) => {
        const result = await this.pullTasks(id)
        if (result.readInFull) readInFull.add(id)
        this.setProgress({ phase: 'changes', done: ++listsDone, total: pull.length })
        return { listId: id, name: names.get(id) ?? id, changed: result.changed, removed: result.removed }
      })
      outcome.changesMs = Date.now() - startedAt

      // Phase 2, full: read every list again and compare with the local copy. Lists the quick pass has just read in full are done.
      if (doFull) {
        outcome.fullCheck = await this.checkEverything(listIds.filter((id) => !readInFull.has(id)))
        await this.pullCategories()
        lastFullSyncAt = Date.now()
        await this.db.setMeta('lastFullSyncAt', lastFullSyncAt)
      }
      await this.flush()
      const failed = await this.db.outbox.filter((op) => op.attempts > 0).count()
      const lastSyncAt = Date.now()
      await this.db.setMeta('lastSyncAt', lastSyncAt)
      await this.setStatus({ state: failed ? 'offline' : 'idle', lastSyncAt, lastFullSyncAt, progress: null, reason: null })
      this.emit('synced')
    } catch (error) {
      outcome.result = isTransient(error) ? 'offline' : 'error'
      outcome.error = describe(error)
      await this.setStatus({ state: outcome.result, error: outcome.error, progress: null, reason: null })
    }
    outcome.sent = this.opsCompleted - sent0
    outcome.requests = this.svc.requestCount - requests0
    return this.finish(outcome)
  }

  /** The full check: every task of `listIds` is read again. Resolves with its duration, size and how many tasks differed. */
  private async checkEverything(listIds: string[]): Promise<SyncOutcome['fullCheck']> {
    if (listIds.length === 0) return null
    const startedAt = Date.now()
    const counts = await Promise.all(listIds.map((id) => this.db.tasks.where('listId').equals(id).count()))
    let done = 0
    let total = counts.reduce((a, b) => a + b, 0)
    this.setProgress({ phase: 'full', done, total })
    this.notify()
    let differences = 0
    await mapLimit(listIds, PARALLEL_LISTS, async (id) => {
      const result = await this.pullTasks(id, true, (received) => {
        done += received
        total = Math.max(total, done)
        this.setProgress({ phase: 'full', done, total })
      })
      differences += result.changed + result.removed
    })
    this.setProgress({ phase: 'full', done, total })
    this.notify()
    return { durationMs: Date.now() - startedAt, checked: done, differences }
  }

  /** Closes a run: the log keeps it for 24 hours (a failing log never fails the sync). */
  private async finish(outcome: SyncOutcome): Promise<SyncOutcome> {
    outcome.endedAt = Date.now()
    try {
      const { syncLog } = this.db
      await syncLog.add({ ...outcome })
      await syncLog.where('startedAt').below(Date.now() - SYNC_LOG_RETENTION_MS).delete()
      const surplus = (await syncLog.count()) - LOG_LIMIT
      if (surplus > 0) await syncLog.bulkDelete(await syncLog.toCollection().limit(surplus).primaryKeys())
    } catch (error) {
      console.warn('Writing the sync log failed', error)
    }
    return outcome
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
        this.opsCompleted++
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

  /**
   * Reads a list's tasks: what changed since the stored delta link, or every task (`full`, or when there is
   * no link yet). `onItems` hears how many tasks each page held. Resolves with how many tasks differed from
   * the local copy (new, changed, gone), and whether the whole list was read.
   */
  async pullTasks(listId: string, full = false, onItems?: (count: number) => void): Promise<PullResult> {
    const key = `delta:tasks:${listId}`
    const link = full ? undefined : await this.db.getMeta<string>(key)
    if (!link) {
      // Initial round: every task (with steps) plus a deltaLink to continue from.
      const initial = await this.svc.tasksDelta(listId, undefined, onItems)
      const result = await this.replaceListTasks(listId, await this.withSteps(listId, initial.changed))
      await this.db.setMeta(key, initial.deltaLink)
      return { ...result, readInFull: true }
    }

    let delta
    try {
      delta = await this.svc.tasksDelta(listId, link, onItems)
    } catch (error) {
      const status = graphStatus(error)
      if (status === 410 || status === 400) {
        // Delta token expired or invalid: start over with a full read.
        await this.db.meta.delete(key)
        return this.pullTasks(listId, true, onItems)
      }
      throw error
    }

    const pending = await this.pendingIds()
    const fresh = await this.withSteps(
      listId,
      delta.changed.filter((t) => !pending.tasks.has(t.id!)),
    )

    const { db } = this
    const result = { changed: 0, removed: 0 }
    await db.transaction('rw', [db.tasks, db.attachments, db.outbox, db.meta], async () => {
      for (const t of fresh) await this.storeIfDifferent(t, listId, result)
      for (const id of delta.removedIds) {
        // Deleted on the server: a delete wins over unsynced local edits.
        if (await db.tasks.get(id)) result.removed++
        await db.tasks.delete(id)
        await db.attachments.where('taskId').equals(id).delete()
        await db.outbox.where('taskId').equals(id).delete()
      }
      await db.setMeta(key, delta.deltaLink)
    })
    return { ...result, readInFull: false }
  }

  /** Stores a server task, counting it when it is new or differs from the local copy (the time it was modified aside: an edit made here comes back with Graph's time). */
  private async storeIfDifferent(server: GraphTodoTask, listId: string, counts: { changed: number }) {
    const local = await this.db.tasks.get(server.id!)
    const next = this.mergeServerTask(server, listId, local)
    if (local && sameTask(local, next)) return
    if (!local || !sameTaskContent(local, next)) counts.changed++
    await this.db.tasks.put(next)
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

  private async replaceListTasks(listId: string, server: GraphTodoTask[]): Promise<{ changed: number; removed: number }> {
    const pending = await this.pendingIds()
    const serverIds = new Set(server.map((t) => t.id!))
    const { db } = this
    const result = { changed: 0, removed: 0 }
    await db.transaction('rw', [db.tasks, db.attachments], async () => {
      for (const t of server) {
        if (pending.tasks.has(t.id!)) continue
        await this.storeIfDifferent(t, listId, result)
      }
      const localIds = (await db.tasks.where('listId').equals(listId).primaryKeys()) as string[]
      for (const id of localIds) {
        if (serverIds.has(id) || isTempId(id) || pending.tasks.has(id)) continue
        await db.tasks.delete(id)
        await db.attachments.where('taskId').equals(id).delete()
        result.removed++
      }
    })
    return result
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

/** What reading a list's tasks changed locally. */
interface PullResult {
  changed: number
  removed: number
  /** Every task of the list was read (not just what changed). */
  readInFull: boolean
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
