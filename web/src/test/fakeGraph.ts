/**
 * In-memory fake of the Microsoft Graph To Do API for tests (MSW handlers).
 * Implements lists (+ open extensions), tasks (+ delta), checklistItems, attachments, /me, master categories and
 * change-notification subscriptions, plus paging, request recording and failure injection.
 */
import type { ChecklistItem, TodoTask, TodoTaskList } from '@microsoft/microsoft-graph-types'
import { http, HttpResponse, type HttpHandler, type PathParams } from 'msw'

const BASE = 'https://graph.microsoft.com/v1.0'

interface StoredTask extends TodoTask {
  id: string
  checklistItems: (ChecklistItem & { id: string })[]
}

interface StoredAttachment {
  id: string
  name: string
  contentType: string
  size: number
  lastModifiedDateTime: string
  contentBytes: string
}

interface StoredList {
  list: TodoTaskList & { id: string }
  tasks: Map<string, StoredTask>
  attachments: Map<string, StoredAttachment[]>
  /** Open extensions by extension name. */
  extensions: Map<string, Record<string, unknown>>
}

interface Change {
  seq: number
  listId: string
  taskId: string
}

export interface FakeSubscription {
  id: string
  resource: string
  changeType: string
  notificationUrl: string
  clientState: string | null
  expirationDateTime: string
}

export interface RecordedRequest {
  method: string
  url: URL
  headers: Headers
  body: unknown
}

interface Failure {
  method: string
  pattern: RegExp
  status: number
  remaining: number
}

let counter = 0
const nextId = (prefix: string) => `${prefix}${++counter}`
const now = () => new Date().toISOString()

export class FakeGraph {
  lists = new Map<string, StoredList>()
  changes: Change[] = []
  listChangeSeq: { seq: number; listId: string }[] = []
  seq = 0
  requests: RecordedRequest[] = []
  pageSize = 1000
  categories = [{ id: 'C1', displayName: 'Red category', color: 'preset0' }]
  /**
   * What PATCH displayName does on a master category. Observed on a live account: 'ignored' (200, old name kept).
   * Graph's docs say it's read-only ('refused' = 400); 'applied' covers the case where a rename works.
   */
  categoryRename: 'ignored' | 'refused' | 'applied' = 'ignored'
  /** Change-notification subscriptions of this app for the user (`/subscriptions`). */
  subscriptions = new Map<string, FakeSubscription>()
  /** Called (and awaited) for each request before it is answered, so a test can look at the app mid-sync. */
  onRequest?: (request: RecordedRequest) => void | Promise<void>
  private failures: Failure[] = []

  addList(displayName: string, extra: Partial<TodoTaskList> = {}): string {
    const id = extra.id ?? nextId('L')
    this.lists.set(id, {
      list: { id, displayName, wellknownListName: 'none', isOwner: true, isShared: false, ...extra },
      tasks: new Map(),
      attachments: new Map(),
      extensions: new Map(),
    })
    this.listChangeSeq.push({ seq: ++this.seq, listId: id })
    return id
  }

  addTask(listId: string, task: Partial<TodoTask> & { title: string }): string {
    const id = task.id ?? nextId('T')
    const stored: StoredTask = {
      status: 'notStarted',
      importance: 'normal',
      isReminderOn: false,
      categories: [],
      hasAttachments: false,
      body: { content: '', contentType: 'text' },
      createdDateTime: now(),
      lastModifiedDateTime: now(),
      ...task,
      id,
      checklistItems: (task.checklistItems ?? []).map((c) => ({ ...c, id: c.id ?? nextId('S'), createdDateTime: c.createdDateTime ?? now() })),
    }
    this.list(listId).tasks.set(id, stored)
    this.touch(listId, id)
    return id
  }

  /** An open extension on a list, by name (like Graph, it can also be addressed by its full id). */
  listExtension(listId: string, name: string): Record<string, unknown> | undefined {
    const all = this.lists.get(listId)?.extensions
    return all?.get(name) ?? [...(all?.values() ?? [])].find((e) => e.id === name)
  }

  task(listId: string, taskId: string): StoredTask | undefined {
    return this.lists.get(listId)?.tasks.get(taskId)
  }

  /** Simulate an edit made by another client (e.g. the official To Do app). */
  serverUpdate(listId: string, taskId: string, patch: Partial<TodoTask>) {
    const t = this.task(listId, taskId)
    if (!t) throw new Error('no such task')
    const steps = patch.checklistItems?.map((c) => ({ ...c, id: c.id ?? nextId('S'), createdDateTime: c.createdDateTime ?? now() }))
    Object.assign(t, patch, steps ? { checklistItems: steps } : {}, { lastModifiedDateTime: now() })
    this.touch(listId, taskId)
  }

  serverDeleteTask(listId: string, taskId: string) {
    this.list(listId).tasks.delete(taskId)
    this.touch(listId, taskId)
  }

  serverDeleteList(listId: string) {
    this.lists.delete(listId)
    this.listChangeSeq.push({ seq: ++this.seq, listId })
  }

  /** Make the next `times` requests matching method+path fail with `status` (0 = network error). */
  failNext(method: string, pattern: RegExp, status: number, times = 1) {
    this.failures.push({ method: method.toUpperCase(), pattern, status, remaining: times })
  }

  private list(listId: string): StoredList {
    const l = this.lists.get(listId)
    if (!l) throw new NotFound()
    return l
  }

  private touch(listId: string, taskId: string) {
    this.changes.push({ seq: ++this.seq, listId, taskId })
  }

  private page<T>(items: T[], url: URL, extra: Record<string, unknown> = {}) {
    const skip = Number(url.searchParams.get('$skip') ?? 0)
    const slice = items.slice(skip, skip + this.pageSize)
    const body: Record<string, unknown> = { value: slice }
    if (skip + this.pageSize < items.length) {
      const next = new URL(url)
      next.searchParams.set('$skip', String(skip + this.pageSize))
      body['@odata.nextLink'] = next.toString()
    } else {
      Object.assign(body, extra)
    }
    return body
  }

  handlers(): HttpHandler[] {
    const wrap =
      (method: string, fn: (ctx: { params: Record<string, string>; url: URL; body: unknown }) => unknown) =>
      async ({ request, params }: { request: Request; params: PathParams }) => {
        const url = new URL(request.url)
        let body: unknown = undefined
        const text = method === 'GET' || method === 'DELETE' ? '' : await request.text()
        if (text) {
          try {
            body = JSON.parse(text)
          } catch {
            body = text
          }
        }
        const recorded = { method, url, headers: request.headers, body }
        this.requests.push(recorded)
        await this.onRequest?.(recorded)
        const failure = this.failures.find(
          (f) => f.method === method && f.remaining > 0 && f.pattern.test(url.pathname),
        )
        if (failure) {
          failure.remaining--
          if (failure.status === 0) return HttpResponse.error() // network failure
          return HttpResponse.json(
            { error: { code: 'injected', message: `Injected ${failure.status}` } },
            { status: failure.status, headers: failure.status === 429 ? { 'Retry-After': '0' } : {} },
          )
        }
        try {
          const result = fn({ params: params as Record<string, string>, url, body })
          if (result instanceof Response) return result
          if (result === undefined) return new HttpResponse(null, { status: 204 })
          return HttpResponse.json(result, { status: method === 'POST' ? 201 : 200 })
        } catch (error) {
          if (error instanceof NotFound) {
            return HttpResponse.json({ error: { code: 'ErrorItemNotFound', message: 'Not found' } }, { status: 404 })
          }
          throw error
        }
      }

    // Like real Graph (measured 2026-11-09): `checklistItems` and `linkedResources` are omitted when empty.
    const taskOut = (t: StoredTask, { steps = true }: { steps?: boolean } = {}) => {
      const { checklistItems, linkedResources, ...rest } = t
      return {
        ...rest,
        ...(steps && checklistItems.length ? { checklistItems } : {}),
        ...(linkedResources?.length ? { linkedResources } : {}),
      }
    }
    const getTask = (p: Record<string, string>) => {
      const t = this.list(p.listId).tasks.get(p.taskId)
      if (!t) throw new NotFound()
      return t
    }

    return [
      // ----- change-notification subscriptions -----
      // Graph doesn't return clientState when listing, and echoes the resource as sent.
      http.get(`${BASE}/subscriptions`, wrap('GET', () => ({
        value: [...this.subscriptions.values()].map((sub) => ({ ...sub, clientState: null })),
      }))),
      http.post(`${BASE}/subscriptions`, wrap('POST', ({ body }) => {
        const input = body as Omit<FakeSubscription, 'id'>
        const sub = { ...input, id: nextId('sub-'), clientState: input.clientState ?? null }
        this.subscriptions.set(sub.id, sub)
        return sub
      })),
      http.patch(`${BASE}/subscriptions/:id`, wrap('PATCH', ({ params, body }) => {
        const sub = this.subscriptions.get(params.id)
        if (!sub) throw new NotFound()
        sub.expirationDateTime = (body as { expirationDateTime: string }).expirationDateTime
        return { ...sub, clientState: null }
      })),
      http.delete(`${BASE}/subscriptions/:id`, wrap('DELETE', ({ params }) => {
        if (!this.subscriptions.delete(params.id)) throw new NotFound()
        return undefined
      })),

      // ----- lists -----
      http.get(`${BASE}/me/todo/lists/delta`, wrap('GET', ({ url }) => {
        const token = Number(url.searchParams.get('$deltatoken') ?? 0)
        const changed = new Set(this.listChangeSeq.filter((c) => c.seq > token).map((c) => c.listId))
        const items = [...changed].map((id) =>
          this.lists.has(id) ? this.lists.get(id)!.list : { id, '@removed': { reason: 'deleted' } },
        )
        return this.page(items, url, { '@odata.deltaLink': `${BASE}/me/todo/lists/delta?$deltatoken=${this.seq}` })
      })),
      http.get(`${BASE}/me/todo/lists`, wrap('GET', ({ url }) =>
        this.page([...this.lists.values()].map((l) => l.list), url),
      )),
      http.post(`${BASE}/me/todo/lists`, wrap('POST', ({ body }) => {
        const id = this.addList((body as { displayName: string }).displayName)
        return this.lists.get(id)!.list
      })),
      http.patch(`${BASE}/me/todo/lists/:listId`, wrap('PATCH', ({ params, body }) => {
        const l = this.list(params.listId)
        Object.assign(l.list, body)
        this.listChangeSeq.push({ seq: ++this.seq, listId: params.listId })
        return l.list
      })),
      http.delete(`${BASE}/me/todo/lists/:listId`, wrap('DELETE', ({ params }) => {
        this.list(params.listId)
        this.lists.delete(params.listId)
        this.listChangeSeq.push({ seq: ++this.seq, listId: params.listId })
      })),

      // ----- open extensions on lists -----
      http.get(`${BASE}/me/todo/lists/:listId/extensions/:extId`, wrap('GET', ({ params }) => {
        this.list(params.listId)
        const ext = this.listExtension(params.listId, params.extId)
        if (!ext) throw new NotFound()
        return ext
      })),
      http.post(`${BASE}/me/todo/lists/:listId/extensions`, wrap('POST', ({ params, body }) => {
        const l = this.list(params.listId)
        const b = body as Record<string, unknown> & { extensionName: string }
        if (l.extensions.has(b.extensionName)) {
          return HttpResponse.json({ error: { code: 'NameAlreadyExists', message: 'Exists' } }, { status: 409 })
        }
        const ext = { ...b, id: `Microsoft.OutlookServices.OpenTypeExtension.${b.extensionName}` }
        l.extensions.set(b.extensionName, ext)
        return ext
      })),
      http.patch(`${BASE}/me/todo/lists/:listId/extensions/:extId`, wrap('PATCH', ({ params, body }) => {
        const ext = this.listExtension(params.listId, params.extId)
        if (!ext) throw new NotFound()
        Object.assign(ext, body)
        return ext
      })),

      // ----- tasks -----
      http.get(`${BASE}/me/todo/lists/:listId/tasks/delta`, wrap('GET', ({ params, url }) => {
        const l = this.list(params.listId)
        const token = Number(url.searchParams.get('$deltatoken') ?? 0)
        const ids = token
          ? [...new Set(this.changes.filter((c) => c.listId === params.listId && c.seq > token).map((c) => c.taskId))]
          : [...l.tasks.keys()]
        // Like real Graph: steps are included when $expand was requested (and the deltaLink keeps it),
        // and the key is omitted for tasks without steps.
        const expand = url.searchParams.get('$expand')
        const items = ids.map((id) => {
          const t = l.tasks.get(id)
          if (!t) return { id, '@removed': { reason: 'deleted' } }
          return taskOut(t, { steps: !!expand?.includes('checklistItems') })
        })
        const link = new URL(`${BASE}/me/todo/lists/${params.listId}/tasks/delta`)
        link.searchParams.set('$deltatoken', String(this.seq))
        if (expand) link.searchParams.set('$expand', expand)
        return this.page(items, url, { '@odata.deltaLink': link.toString() })
      })),
      http.get(`${BASE}/me/todo/lists/:listId/tasks`, wrap('GET', ({ params, url }) =>
        this.page([...this.list(params.listId).tasks.values()].map((t) => taskOut(t)), url),
      )),
      http.post(`${BASE}/me/todo/lists/:listId/tasks`, wrap('POST', ({ params, body }) => {
        const id = this.addTask(params.listId, body as TodoTask & { title: string })
        return taskOut(this.task(params.listId, id)!)
      })),
      http.get(`${BASE}/me/todo/lists/:listId/tasks/:taskId`, wrap('GET', ({ params }) => taskOut(getTask(params)))),
      http.patch(`${BASE}/me/todo/lists/:listId/tasks/:taskId`, wrap('PATCH', ({ params, body }) => {
        const t = getTask(params)
        Object.assign(t, body, { lastModifiedDateTime: now() })
        if ((body as TodoTask).status === 'completed') {
          t.completedDateTime = { dateTime: now().replace('Z', ''), timeZone: 'UTC' }
        }
        this.touch(params.listId, params.taskId)
        return taskOut(t)
      })),
      http.delete(`${BASE}/me/todo/lists/:listId/tasks/:taskId`, wrap('DELETE', ({ params }) => {
        getTask(params)
        this.list(params.listId).tasks.delete(params.taskId)
        this.touch(params.listId, params.taskId)
      })),

      // ----- checklist items -----
      http.post(`${BASE}/me/todo/lists/:listId/tasks/:taskId/checklistItems`, wrap('POST', ({ params, body }) => {
        const t = getTask(params)
        const item = { id: nextId('S'), createdDateTime: now(), isChecked: false, ...(body as ChecklistItem) }
        t.checklistItems.push(item as ChecklistItem & { id: string })
        return item
      })),
      http.patch(`${BASE}/me/todo/lists/:listId/tasks/:taskId/checklistItems/:stepId`, wrap('PATCH', ({ params, body }) => {
        const item = getTask(params).checklistItems.find((c) => c.id === params.stepId)
        if (!item) throw new NotFound()
        Object.assign(item, body)
        return item
      })),
      http.delete(`${BASE}/me/todo/lists/:listId/tasks/:taskId/checklistItems/:stepId`, wrap('DELETE', ({ params }) => {
        const t = getTask(params)
        const before = t.checklistItems.length
        t.checklistItems = t.checklistItems.filter((c) => c.id !== params.stepId)
        if (t.checklistItems.length === before) throw new NotFound()
      })),

      // ----- attachments -----
      http.get(`${BASE}/me/todo/lists/:listId/tasks/:taskId/attachments`, wrap('GET', ({ params, url }) => {
        getTask(params)
        const items = (this.list(params.listId).attachments.get(params.taskId) ?? []).map(
          ({ contentBytes: _c, ...meta }) => meta,
        )
        return this.page(items, url)
      })),
      http.post(`${BASE}/me/todo/lists/:listId/tasks/:taskId/attachments`, wrap('POST', ({ params, body }) => {
        const t = getTask(params)
        const b = body as { name: string; contentType: string; contentBytes: string }
        const att: StoredAttachment = {
          id: nextId('A'),
          name: b.name,
          contentType: b.contentType,
          size: atob(b.contentBytes).length,
          lastModifiedDateTime: now(),
          contentBytes: b.contentBytes,
        }
        const all = this.list(params.listId).attachments
        all.set(params.taskId, [...(all.get(params.taskId) ?? []), att])
        t.hasAttachments = true
        this.touch(params.listId, params.taskId)
        const { contentBytes: _c, ...meta } = att
        return meta
      })),
      http.get(`${BASE}/me/todo/lists/:listId/tasks/:taskId/attachments/:attId/$value`, wrap('GET', ({ params }) => {
        const att = this.list(params.listId).attachments.get(params.taskId)?.find((a) => a.id === params.attId)
        if (!att) throw new NotFound()
        const bytes = Uint8Array.from(atob(att.contentBytes), (c) => c.charCodeAt(0))
        return new HttpResponse(bytes, { headers: { 'Content-Type': att.contentType } })
      })),
      http.delete(`${BASE}/me/todo/lists/:listId/tasks/:taskId/attachments/:attId`, wrap('DELETE', ({ params }) => {
        const all = this.list(params.listId).attachments
        const rest = (all.get(params.taskId) ?? []).filter((a) => a.id !== params.attId)
        all.set(params.taskId, rest)
        getTask(params).hasAttachments = rest.length > 0
        this.touch(params.listId, params.taskId)
      })),

      // ----- profile -----
      http.get(`${BASE}/me`, wrap('GET', () => ({
        id: 'U1',
        displayName: 'Test User',
        mail: null,
        userPrincipalName: 'test@example.com',
      }))),
      http.get(`${BASE}/me/photo/$value`, wrap('GET', () => {
        throw new NotFound()
      })),
      http.get(`${BASE}/me/outlook/masterCategories`, wrap('GET', ({ url }) => this.page(this.categories, url))),
      http.post(`${BASE}/me/outlook/masterCategories`, wrap('POST', ({ body }) => {
        const { displayName, color } = body as { displayName: string; color: string }
        if (this.categories.some((c) => c.displayName.toLowerCase() === displayName.toLowerCase())) {
          return HttpResponse.json({ error: { code: 'ErrorCategoryNameAlreadyExists', message: 'Exists' } }, { status: 409 })
        }
        const created = { id: nextId('C'), displayName, color }
        this.categories.push(created)
        return created
      })),
      http.patch(`${BASE}/me/outlook/masterCategories/:id`, wrap('PATCH', ({ params, body }) => {
        const category = this.categories.find((c) => c.id === params.id)
        if (!category) throw new NotFound()
        const patch = body as { displayName?: string; color?: string }
        if (patch.displayName !== undefined && this.categoryRename === 'refused') {
          return HttpResponse.json({ error: { code: 'ErrorInvalidRequest', message: 'displayName is read-only' } }, { status: 400 })
        }
        if (patch.displayName !== undefined && this.categoryRename === 'ignored') delete patch.displayName
        Object.assign(category, patch)
        return category
      })),
      http.delete(`${BASE}/me/outlook/masterCategories/:id`, wrap('DELETE', ({ params }) => {
        if (!this.categories.some((c) => c.id === params.id)) throw new NotFound()
        this.categories = this.categories.filter((c) => c.id !== params.id)
      })),
    ]
  }
}

class NotFound extends Error {}
