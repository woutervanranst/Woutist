import {
  applyChanges,
  isTempId,
  newLocalTask,
  newTempId,
  type Step,
  type Task,
  type TaskChanges,
  type TodoList,
} from '../models/todo'
import { todayLocal } from '../models/time'
import type { AttachmentRecord, OutboxEntry, OutboxOp, WoutistDb } from './db'
import { MAX_ATTACHMENT_SIZE } from './taskService'

export class RepositoryError extends Error {}

/**
 * All local writes go through here: the change is applied to IndexedDB immediately (optimistic UI)
 * and a matching operation is queued in the outbox for the sync engine to push to Graph.
 */
export class TodoRepository {
  private readonly db: WoutistDb
  private readonly onLocalChange: () => void

  constructor(db: WoutistDb, onLocalChange: () => void = () => {}) {
    this.db = db
    this.onLocalChange = onLocalChange
  }

  private get rw() {
    const { lists, tasks, attachments, outbox, meta } = this.db
    return [lists, tasks, attachments, outbox, meta]
  }

  private async enqueue(op: OutboxOp): Promise<void> {
    const entry: OutboxEntry = { ...op, createdAt: Date.now(), attempts: 0, nextAttemptAt: 0 }
    await this.db.outbox.add(entry)
  }

  private async purgeOps(match: (op: OutboxEntry) => boolean): Promise<void> {
    await this.db.outbox.filter(match).delete()
  }

  private async mustGetTask(taskId: string): Promise<Task> {
    const task = await this.db.tasks.get(taskId)
    if (!task) throw new RepositoryError(`Task ${taskId} not found`)
    return task
  }

  private done<T>(value: T): T {
    this.onLocalChange()
    return value
  }

  // ---------- lists ----------

  async createList(displayName: string): Promise<string> {
    const name = displayName.trim()
    if (!name) throw new RepositoryError('List name is required')
    const id = newTempId()
    await this.db.transaction('rw', this.rw, async () => {
      const last = await this.db.lists.orderBy('sortIndex').last()
      const list: TodoList = {
        id,
        displayName: name,
        wellknownListName: 'none',
        isOwner: true,
        isShared: false,
        sortIndex: (last?.sortIndex ?? 0) + 1,
      }
      await this.db.lists.add(list)
      await this.enqueue({ type: 'list.create', listId: id })
    })
    return this.done(id)
  }

  async renameList(listId: string, displayName: string): Promise<void> {
    const name = displayName.trim()
    if (!name) throw new RepositoryError('List name is required')
    await this.db.transaction('rw', this.rw, async () => {
      const list = await this.db.lists.get(listId)
      if (!list) throw new RepositoryError(`List ${listId} not found`)
      if (list.wellknownListName !== 'none') throw new RepositoryError('Built-in lists cannot be renamed')
      await this.db.lists.update(listId, { displayName: name })
      if (!isTempId(listId)) await this.enqueue({ type: 'list.update', listId, displayName: name })
    })
    this.done(undefined)
  }

  async deleteList(listId: string): Promise<void> {
    await this.db.transaction('rw', this.rw, async () => {
      const list = await this.db.lists.get(listId)
      if (!list) return
      if (list.wellknownListName !== 'none') throw new RepositoryError('Built-in lists cannot be deleted')
      await this.db.tasks.where('listId').equals(listId).delete()
      await this.db.attachments.filter((a) => a.listId === listId).delete()
      await this.db.lists.delete(listId)
      await this.db.meta.delete(`delta:tasks:${listId}`)
      await this.purgeOps((op) => op.listId === listId)
      if (!isTempId(listId)) await this.enqueue({ type: 'list.delete', listId })
    })
    this.done(undefined)
  }

  // ---------- tasks ----------

  async addTask(listId: string, title: string, changes: TaskChanges = {}): Promise<string> {
    const name = title.trim()
    if (!name) throw new RepositoryError('Task title is required')
    const task = newLocalTask(listId, name, normalizeChanges(undefined, changes))
    await this.db.transaction('rw', this.rw, async () => {
      if (!(await this.db.lists.get(listId))) throw new RepositoryError(`List ${listId} not found`)
      await this.db.tasks.add(task)
      await this.enqueue({ type: 'task.create', listId, taskId: task.id })
    })
    return this.done(task.id)
  }

  async updateTask(taskId: string, changes: TaskChanges): Promise<void> {
    await this.db.transaction('rw', this.rw, async () => {
      const task = await this.mustGetTask(taskId)
      const final = normalizeChanges(task, changes)
      if (Object.keys(final).length === 0) return
      await this.db.tasks.put(applyChanges(task, final))
      // A not-yet-created task sends its latest state when created, so no update op is needed.
      if (!isTempId(taskId)) {
        await this.enqueue({ type: 'task.update', listId: task.listId, taskId, changes: final })
      }
    })
    this.done(undefined)
  }

  async toggleCompleted(taskId: string): Promise<void> {
    const task = await this.mustGetTask(taskId)
    await this.updateTask(taskId, { status: task.completed ? 'notStarted' : 'completed' })
  }

  async toggleImportant(taskId: string): Promise<void> {
    const task = await this.mustGetTask(taskId)
    await this.updateTask(taskId, { importance: task.important ? 'normal' : 'high' })
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.db.transaction('rw', this.rw, async () => {
      const task = await this.db.tasks.get(taskId)
      if (!task) return
      await this.db.tasks.delete(taskId)
      await this.db.attachments.where('taskId').equals(taskId).delete()
      await this.purgeOps((op) => op.taskId === taskId)
      if (!isTempId(taskId)) await this.enqueue({ type: 'task.delete', listId: task.listId, taskId })
    })
    this.done(undefined)
  }

  /**
   * Graph has no "move": the task is re-created in the target list (with its steps and
   * attachments) and deleted from the source. The moved task gets a new id and creation date.
   */
  async moveTask(taskId: string, targetListId: string): Promise<string> {
    let resultId = taskId
    await this.db.transaction('rw', this.rw, async () => {
      const task = await this.mustGetTask(taskId)
      if (task.listId === targetListId) return
      if (!(await this.db.lists.get(targetListId))) throw new RepositoryError('Target list not found')

      if (isTempId(taskId)) {
        // Not on the server yet: just retarget the pending operations.
        await this.db.tasks.update(taskId, { listId: targetListId })
        await this.db.outbox.where('taskId').equals(taskId).modify((op) => {
          op.listId = targetListId
        })
        await this.db.attachments.where('taskId').equals(taskId).modify((a) => {
          a.listId = targetListId
        })
        return
      }

      const moved: Task = {
        ...task,
        id: newTempId(),
        listId: targetListId,
        steps: task.steps.map((s) => ({ ...s, id: newTempId() })),
      }
      resultId = moved.id
      await this.db.tasks.add(moved)
      await this.enqueue({ type: 'task.create', listId: targetListId, taskId: moved.id })
      for (const step of moved.steps) {
        await this.enqueue({ type: 'step.create', listId: targetListId, taskId: moved.id, stepId: step.id })
      }
      const attachments = await this.db.attachments.where('taskId').equals(taskId).toArray()
      for (const att of attachments) {
        if (isTempId(att.id)) {
          // Upload still pending: retarget it to the new task.
          await this.db.attachments.update(att.id, { taskId: moved.id, listId: targetListId })
          await this.db.outbox
            .filter((op) => op.type === 'attachment.upload' && op.attachmentId === att.id)
            .modify((op) => {
              op.taskId = moved.id
              op.listId = targetListId
            })
        } else {
          await this.db.attachments.update(att.id, { taskId: moved.id, listId: targetListId })
          await this.enqueue({
            type: 'attachment.copy',
            listId: targetListId,
            taskId: moved.id,
            fromListId: task.listId,
            fromTaskId: taskId,
            fromAttachmentId: att.id,
            name: att.name,
          })
        }
      }
      await this.db.tasks.delete(taskId)
      await this.purgeOps((op) => op.taskId === taskId && op.type !== 'attachment.upload')
      await this.enqueue({ type: 'task.delete', listId: task.listId, taskId })
    })
    return this.done(resultId)
  }

  // ---------- steps ----------

  async addStep(taskId: string, displayName: string): Promise<string> {
    const name = displayName.trim()
    if (!name) throw new RepositoryError('Step name is required')
    const step: Step = {
      id: newTempId(),
      displayName: name,
      isChecked: false,
      createdDateTime: new Date().toISOString(),
      checkedDateTime: null,
    }
    await this.db.transaction('rw', this.rw, async () => {
      const task = await this.mustGetTask(taskId)
      await this.db.tasks.update(taskId, { steps: [...task.steps, step] })
      await this.enqueue({ type: 'step.create', listId: task.listId, taskId, stepId: step.id })
    })
    return this.done(step.id)
  }

  async updateStep(
    taskId: string,
    stepId: string,
    patch: Partial<Pick<Step, 'displayName' | 'isChecked'>>,
  ): Promise<void> {
    await this.db.transaction('rw', this.rw, async () => {
      const task = await this.mustGetTask(taskId)
      const steps = task.steps.map((s) =>
        s.id === stepId
          ? {
              ...s,
              ...patch,
              checkedDateTime:
                patch.isChecked === undefined
                  ? s.checkedDateTime
                  : patch.isChecked
                    ? new Date().toISOString()
                    : null,
            }
          : s,
      )
      await this.db.tasks.update(taskId, { steps })
      if (!isTempId(stepId)) {
        await this.enqueue({ type: 'step.update', listId: task.listId, taskId, stepId, patch })
      }
    })
    this.done(undefined)
  }

  async deleteStep(taskId: string, stepId: string): Promise<void> {
    await this.db.transaction('rw', this.rw, async () => {
      const task = await this.mustGetTask(taskId)
      await this.db.tasks.update(taskId, { steps: task.steps.filter((s) => s.id !== stepId) })
      if (isTempId(stepId)) {
        await this.purgeOps((op) => 'stepId' in op && op.stepId === stepId)
      } else {
        await this.purgeOps((op) => op.type === 'step.update' && op.stepId === stepId)
        await this.enqueue({ type: 'step.delete', listId: task.listId, taskId, stepId })
      }
    })
    this.done(undefined)
  }

  /** Turn a step into a task of its own in the same list. */
  async promoteStep(taskId: string, stepId: string): Promise<string> {
    const task = await this.mustGetTask(taskId)
    const step = task.steps.find((s) => s.id === stepId)
    if (!step) throw new RepositoryError('Step not found')
    const newId = await this.addTask(task.listId, step.displayName)
    await this.deleteStep(taskId, stepId)
    return newId
  }

  // ---------- attachments ----------

  async addAttachment(taskId: string, file: File | Blob, name?: string): Promise<string> {
    if (file.size > MAX_ATTACHMENT_SIZE) throw new RepositoryError('Attachments are limited to 25 MB')
    const id = newTempId()
    // Read before the transaction: awaiting non-IndexedDB work inside one would end it.
    const data = await file.arrayBuffer()
    await this.db.transaction('rw', this.rw, async () => {
      const task = await this.mustGetTask(taskId)
      const record: AttachmentRecord = {
        id,
        listId: task.listId,
        taskId,
        name: name ?? ('name' in file ? file.name : 'attachment'),
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        lastModifiedDateTime: new Date().toISOString(),
        data,
      }
      await this.db.attachments.add(record)
      await this.db.tasks.update(taskId, { hasAttachments: true })
      await this.enqueue({ type: 'attachment.upload', listId: task.listId, taskId, attachmentId: id })
    })
    return this.done(id)
  }

  async deleteAttachment(taskId: string, attachmentId: string): Promise<void> {
    await this.db.transaction('rw', this.rw, async () => {
      const task = await this.mustGetTask(taskId)
      await this.db.attachments.delete(attachmentId)
      const remaining = await this.db.attachments.where('taskId').equals(taskId).count()
      await this.db.tasks.update(taskId, { hasAttachments: remaining > 0 })
      if (isTempId(attachmentId)) {
        await this.purgeOps((op) => op.type === 'attachment.upload' && op.attachmentId === attachmentId)
      } else {
        await this.enqueue({ type: 'attachment.delete', listId: task.listId, taskId, attachmentId })
      }
    })
    this.done(undefined)
  }
}

/**
 * Keep task edits consistent with how Microsoft To Do behaves:
 * - a repeating task needs a due date (defaults to today)
 * - setting a reminder time turns the reminder on; clearing it turns it off
 */
export function normalizeChanges(task: Task | undefined, changes: TaskChanges): TaskChanges {
  const out: TaskChanges = { ...changes }
  if (out.title !== undefined) out.title = out.title.trim()
  if (out.recurrence && !(out.dueDate ?? task?.dueDate)) out.dueDate = todayLocal()
  if (out.reminderAt !== undefined && out.isReminderOn === undefined) out.isReminderOn = out.reminderAt !== null
  if (out.dueDate === null && task?.recurrence && out.recurrence === undefined) out.recurrence = null
  if (task) {
    for (const key of Object.keys(out) as (keyof TaskChanges)[]) {
      if (JSON.stringify(out[key]) === JSON.stringify(task[key])) delete out[key]
    }
  }
  return out
}
