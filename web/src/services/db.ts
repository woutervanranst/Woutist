import Dexie, { type EntityTable } from 'dexie'
import type { Step, Task, TaskChanges, TodoList } from '../models/todo'

/** Attachment metadata (content is fetched on demand; pending uploads keep their blob). */
export interface AttachmentRecord {
  id: string
  listId: string
  taskId: string
  name: string
  contentType: string
  size: number
  lastModifiedDateTime: string
  /** File content, present only for uploads that haven't reached Graph yet. */
  data?: ArrayBuffer
}

export interface CategoryRecord {
  /** Graph id, needed to recolor or delete. Absent only on rows cached before category editing existed. */
  id?: string
  displayName: string
  color: string
}

export interface MetaRecord {
  key: string
  value: unknown
}

/**
 * A pending change to push to Graph. Create ops carry only ids: the payload is read from the
 * local record at flush time, so edits made before the first sync are folded in automatically.
 */
export type OutboxOp =
  | { type: 'list.create'; listId: string; taskId?: undefined }
  | { type: 'list.update'; listId: string; displayName: string; taskId?: undefined }
  | { type: 'list.delete'; listId: string; taskId?: undefined }
  | { type: 'task.create'; listId: string; taskId: string }
  | { type: 'task.update'; listId: string; taskId: string; changes: TaskChanges }
  | { type: 'task.delete'; listId: string; taskId: string }
  | { type: 'step.create'; listId: string; taskId: string; stepId: string }
  | { type: 'step.update'; listId: string; taskId: string; stepId: string; patch: Partial<Pick<Step, 'displayName' | 'isChecked'>> }
  | { type: 'step.delete'; listId: string; taskId: string; stepId: string }
  | { type: 'attachment.upload'; listId: string; taskId: string; attachmentId: string }
  | { type: 'attachment.copy'; listId: string; taskId: string; fromListId: string; fromTaskId: string; fromAttachmentId: string; name: string }
  | { type: 'attachment.delete'; listId: string; taskId: string; attachmentId: string }

export type OutboxEntry = OutboxOp & {
  seq?: number
  createdAt: number
  attempts: number
  nextAttemptAt: number
  lastError?: string
}

export class WoutistDb extends Dexie {
  lists!: EntityTable<TodoList, 'id'>
  tasks!: EntityTable<Task, 'id'>
  attachments!: EntityTable<AttachmentRecord, 'id'>
  categories!: EntityTable<CategoryRecord, 'displayName'>
  outbox!: EntityTable<OutboxEntry, 'seq'>
  meta!: EntityTable<MetaRecord, 'key'>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      lists: 'id, sortIndex',
      tasks: 'id, listId, [listId+completed], completed, important, dueDate, reminderAt, createdDateTime',
      attachments: 'id, taskId',
      categories: 'displayName',
      outbox: '++seq, taskId, listId',
      meta: 'key',
    })
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.meta.get(key))?.value as T | undefined
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.meta.put({ key, value })
  }
}

export const DB_PREFIX = 'woutist-'

/** One database per signed-in account, so accounts never see each other's data. */
export function dbNameForAccount(accountKey: string): string {
  return `${DB_PREFIX}${accountKey}`
}

export function openAccountDb(accountKey: string): WoutistDb {
  return new WoutistDb(dbNameForAccount(accountKey))
}

export async function deleteAccountDb(accountKey: string): Promise<void> {
  await Dexie.delete(dbNameForAccount(accountKey))
}
