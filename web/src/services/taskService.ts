import { type Client, ResponseType } from '@microsoft/microsoft-graph-client'
import type {
  AttachmentBase,
  ChecklistItem,
  OutlookCategory,
  Subscription,
  TodoTask,
  TodoTaskList,
  User,
} from '@microsoft/microsoft-graph-types'
import { userTimeZone } from '../models/time'
import { graphStatus, isNotFound } from './graphClient'

const TASK_EXPAND = 'checklistItems,linkedResources'
const ATTACHMENT_SELECT = 'id,name,contentType,size,lastModifiedDateTime'
/** Graph accepts direct attachment uploads below 3 MB; larger files need an upload session. */
export const DIRECT_UPLOAD_LIMIT = 3 * 1024 * 1024
export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024
const UPLOAD_CHUNK = 4 * 320 * 1024 // multiple of 320 KiB, < 4 MB

interface Page<T> {
  value: T[]
  '@odata.nextLink'?: string
  '@odata.deltaLink'?: string
}

export interface DeltaResult<T> {
  changed: T[]
  removedIds: string[]
  deltaLink: string
}

type Removable<T> = T & { id: string; '@removed'?: { reason?: string } }

const enc = encodeURIComponent

/**
 * Thin wrapper over the Microsoft Graph To Do API. Returns Graph-native shapes; mapping to the
 * domain model happens in the sync layer. All date-times are requested in the user's zone.
 */
export class TaskService {
  private readonly client: Client
  private readonly prefer: string

  constructor(client: Client, timeZone: string = userTimeZone()) {
    this.client = client
    this.prefer = `outlook.timezone="${timeZone}"`
  }

  /** HTTP requests made to Graph so far (also counts nextLink pages). Callers diff it around a piece of work. */
  get requestCount(): number {
    return this.requests
  }
  private requests = 0

  /** Every request starts here, so it is counted once. */
  private raw(path: string) {
    this.requests++
    return this.client.api(path)
  }

  private api(path: string) {
    return this.raw(path).header('Prefer', this.prefer)
  }

  /** Reads all pages. `onPage` gets the number of items of each page as it arrives. */
  private async collect<T>(
    first: Page<T>,
    onPage?: (count: number) => void,
  ): Promise<{ items: T[]; deltaLink?: string }> {
    const items = [...first.value]
    onPage?.(first.value.length)
    let page = first
    while (page['@odata.nextLink']) {
      page = (await this.api(page['@odata.nextLink']).get()) as Page<T>
      items.push(...page.value)
      onPage?.(page.value.length)
    }
    return { items, deltaLink: page['@odata.deltaLink'] }
  }

  // ---------- lists ----------

  async getLists(): Promise<TodoTaskList[]> {
    const first = (await this.api('/me/todo/lists').get()) as Page<TodoTaskList>
    return (await this.collect(first)).items
  }

  createList(displayName: string): Promise<TodoTaskList> {
    return this.api('/me/todo/lists').post({ displayName })
  }

  updateList(listId: string, patch: { displayName: string }): Promise<TodoTaskList> {
    return this.api(`/me/todo/lists/${enc(listId)}`).patch(patch)
  }

  async deleteList(listId: string): Promise<void> {
    await this.api(`/me/todo/lists/${enc(listId)}`).delete()
  }

  // ---------- open extensions on a list (Woutist's synced settings) ----------

  /** An open extension on a list, by name; null when it doesn't exist. */
  async getListExtension(listId: string, name: string): Promise<Record<string, unknown> | null> {
    try {
      return await this.api(`/me/todo/lists/${enc(listId)}/extensions/${enc(name)}`).get()
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  /** Create or update an open extension on a list. */
  async saveListExtension(listId: string, name: string, data: Record<string, unknown>, exists: boolean): Promise<void> {
    const base = `/me/todo/lists/${enc(listId)}/extensions`
    const body = { '@odata.type': 'microsoft.graph.openTypeExtension', extensionName: name, ...data }
    const create = () => this.api(base).post(body)
    const update = () => this.api(`${base}/${enc(name)}`).patch(body)
    try {
      await (exists ? update() : create())
    } catch (error) {
      // Deleted or created elsewhere since it was read: take the other route once.
      const status = graphStatus(error)
      if (exists && status === 404) await create()
      else if (!exists && status === 409) await update()
      else throw error
    }
  }

  // ---------- tasks ----------

  async getTasks(listId: string): Promise<TodoTask[]> {
    const first = (await this.api(`/me/todo/lists/${enc(listId)}/tasks`)
      .expand(TASK_EXPAND)
      .top(100)
      .get()) as Page<TodoTask>
    return (await this.collect(first)).items
  }

  /** Returns null when the task no longer exists. */
  async getTask(listId: string, taskId: string): Promise<TodoTask | null> {
    try {
      return await this.api(`/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}`)
        .expand(TASK_EXPAND)
        .get()
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  createTask(listId: string, task: TodoTask): Promise<TodoTask> {
    return this.api(`/me/todo/lists/${enc(listId)}/tasks`).post(task)
  }

  updateTask(listId: string, taskId: string, patch: TodoTask): Promise<TodoTask> {
    return this.api(`/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}`).patch(patch)
  }

  async deleteTask(listId: string, taskId: string): Promise<void> {
    await this.api(`/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}`).delete()
  }

  /**
   * Incremental changes to a list's tasks. Pass the previous deltaLink, or nothing for an initial
   * round (which returns every task and a deltaLink to continue from).
   */
  async tasksDelta(
    listId: string,
    deltaLink?: string,
    onPage?: (count: number) => void,
  ): Promise<DeltaResult<TodoTask>> {
    // $expand is honoured by delta and carried over in the deltaLink, so changed tasks arrive with
    // their steps (verified against the live API, see docs/graph-api-notes.md).
    const first = (await (deltaLink
      ? this.api(deltaLink)
      : this.api(`/me/todo/lists/${enc(listId)}/tasks/delta`).expand(TASK_EXPAND)
    ).get()) as Page<Removable<TodoTask>>
    const { items, deltaLink: next } = await this.collect(first, onPage)
    return splitDelta(items, next)
  }

  // ---------- change-notification subscriptions ----------

  /** This app's change-notification subscriptions for the signed-in user. */
  async listSubscriptions(): Promise<Subscription[]> {
    const first = (await this.raw('/subscriptions').get()) as Page<Subscription>
    return (await this.collect(first)).items
  }

  async createSubscription(subscription: Subscription): Promise<Subscription> {
    return (await this.raw('/subscriptions').post(subscription)) as Subscription
  }

  async renewSubscription(id: string, expirationDateTime: string): Promise<void> {
    await this.raw(`/subscriptions/${enc(id)}`).patch({ expirationDateTime })
  }

  async deleteSubscription(id: string): Promise<void> {
    await this.raw(`/subscriptions/${enc(id)}`).delete()
  }

  async listsDelta(deltaLink?: string): Promise<DeltaResult<TodoTaskList>> {
    const first = (await this.api(deltaLink ?? '/me/todo/lists/delta').get()) as Page<
      Removable<TodoTaskList>
    >
    const { items, deltaLink: next } = await this.collect(first)
    return splitDelta(items, next)
  }

  // ---------- steps (checklistItems) ----------

  createStep(
    listId: string,
    taskId: string,
    step: { displayName: string; isChecked?: boolean },
  ): Promise<ChecklistItem> {
    return this.api(`/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/checklistItems`).post(step)
  }

  updateStep(
    listId: string,
    taskId: string,
    stepId: string,
    patch: { displayName?: string; isChecked?: boolean },
  ): Promise<ChecklistItem> {
    return this.api(
      `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/checklistItems/${enc(stepId)}`,
    ).patch(patch)
  }

  async deleteStep(listId: string, taskId: string, stepId: string): Promise<void> {
    await this.api(
      `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/checklistItems/${enc(stepId)}`,
    ).delete()
  }

  // ---------- attachments ----------

  async getAttachments(listId: string, taskId: string): Promise<AttachmentBase[]> {
    const first = (await this.api(`/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/attachments`)
      .select(ATTACHMENT_SELECT)
      .get()) as Page<AttachmentBase>
    return (await this.collect(first)).items
  }

  async downloadAttachment(listId: string, taskId: string, attachmentId: string): Promise<Blob> {
    return this.api(
      `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/attachments/${enc(attachmentId)}/$value`,
    )
      .responseType(ResponseType.BLOB)
      .get()
  }

  async uploadAttachment(
    listId: string,
    taskId: string,
    file: Blob,
    name: string,
  ): Promise<AttachmentBase | null> {
    if (file.size > MAX_ATTACHMENT_SIZE) throw new Error('Attachments are limited to 25 MB')
    const base = `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/attachments`
    const contentType = file.type || 'application/octet-stream'
    if (file.size < DIRECT_UPLOAD_LIMIT) {
      return this.api(base).post({
        '@odata.type': '#microsoft.graph.taskFileAttachment',
        name,
        contentType,
        contentBytes: await blobToBase64(file),
      })
    }
    const session = (await this.api(`${base}/createUploadSession`).post({
      attachmentInfo: { attachmentType: 'file', name, size: file.size },
    })) as { uploadUrl: string }
    // The upload URL is pre-authenticated: it must be called without an Authorization header.
    let last: Response | null = null
    for (let start = 0; start < file.size; start += UPLOAD_CHUNK) {
      const end = Math.min(start + UPLOAD_CHUNK, file.size)
      this.requests++
      last = await fetch(session.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Range': `bytes ${start}-${end - 1}/${file.size}`,
        },
        body: file.slice(start, end),
      })
      if (!last.ok) throw new Error(`Attachment upload failed (${last.status})`)
    }
    return null // Graph doesn't return the attachment here; the caller refetches metadata.
  }

  async deleteAttachment(listId: string, taskId: string, attachmentId: string): Promise<void> {
    await this.api(
      `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/attachments/${enc(attachmentId)}`,
    ).delete()
  }

  // ---------- profile & categories ----------

  getMe(): Promise<User> {
    return this.raw('/me').select('id,displayName,mail,userPrincipalName').get()
  }

  async getMyPhoto(): Promise<Blob | null> {
    try {
      return await this.raw('/me/photo/$value').responseType(ResponseType.BLOB).get()
    } catch {
      return null // no photo, or not supported for this account type
    }
  }

  async getCategories(): Promise<OutlookCategory[]> {
    try {
      const first = (await this.raw('/me/outlook/masterCategories').get()) as Page<OutlookCategory>
      return (await this.collect(first)).items
    } catch {
      return [] // mailbox not available for this account: categories still work as plain names
    }
  }

  // The writes throw on purpose: Settings shows the error. Graph answers 409 for a duplicate name.
  createCategory(displayName: string, color: string): Promise<OutlookCategory> {
    return this.raw('/me/outlook/masterCategories').post({ displayName, color })
  }

  /** `displayName` is documented as immutable on Graph; callers fall back to create + delete when it's refused. */
  updateCategory(id: string, patch: { displayName?: string; color?: string }): Promise<OutlookCategory> {
    return this.raw(`/me/outlook/masterCategories/${enc(id)}`).patch(patch)
  }

  async deleteCategory(id: string): Promise<void> {
    await this.raw(`/me/outlook/masterCategories/${enc(id)}`).delete()
  }
}

function splitDelta<T extends { id?: string }>(
  items: Removable<T>[],
  deltaLink: string | undefined,
): DeltaResult<T> {
  if (!deltaLink) throw new Error('Graph delta response without @odata.deltaLink')
  const changed: T[] = []
  const removedIds: string[] = []
  for (const item of items) {
    if (item['@removed']) removedIds.push(item.id)
    else changed.push(item)
  }
  return { changed, removedIds, deltaLink }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
