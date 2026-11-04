import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FakeGraph } from '../test/fakeGraph'
import { createGraphClient, isNotFound } from './graphClient'
import { TaskService } from './taskService'

const server = setupServer()
let fake: FakeGraph
let svc: TaskService

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  fake = new FakeGraph()
  server.resetHandlers(...fake.handlers())
  svc = new TaskService(createGraphClient(async () => 'test-token'), 'Europe/Brussels')
})
afterEach(() => server.resetHandlers())

describe('TaskService', () => {
  it('sends the bearer token and the time zone preference', async () => {
    fake.addList('Tasks', { wellknownListName: 'defaultList' })
    await svc.getLists()
    const req = fake.requests.at(-1)!
    expect(req.headers.get('authorization')).toBe('Bearer test-token')
    expect(req.headers.get('prefer')).toBe('outlook.timezone="Europe/Brussels"')
  })

  it('follows @odata.nextLink paging', async () => {
    fake.pageSize = 2
    const listId = fake.addList('Big')
    for (let i = 0; i < 5; i++) fake.addTask(listId, { title: `t${i}` })
    const tasks = await svc.getTasks(listId)
    expect(tasks.map((t) => t.title)).toEqual(['t0', 't1', 't2', 't3', 't4'])
  })

  it('expands steps and linked resources on task reads', async () => {
    const listId = fake.addList('L')
    fake.addTask(listId, { title: 'with steps', checklistItems: [{ displayName: 'a', isChecked: false }] })
    const [task] = await svc.getTasks(listId)
    expect(task.checklistItems).toHaveLength(1)
    expect(fake.requests.at(-1)!.url.searchParams.get('$expand')).toBe('checklistItems,linkedResources')
  })

  it('does task CRUD', async () => {
    const listId = fake.addList('L')
    const created = await svc.createTask(listId, { title: 'New' })
    expect(created.id).toBeTruthy()
    await svc.updateTask(listId, created.id!, { importance: 'high' })
    expect(fake.task(listId, created.id!)?.importance).toBe('high')
    await svc.deleteTask(listId, created.id!)
    expect(fake.task(listId, created.id!)).toBeUndefined()
    expect(await svc.getTask(listId, created.id!)).toBeNull()
  })

  it('reports deletes and changes through delta', async () => {
    const listId = fake.addList('L')
    const a = fake.addTask(listId, { title: 'a' })
    const b = fake.addTask(listId, { title: 'b' })
    const initial = await svc.tasksDelta(listId)
    expect(initial.changed.map((t) => t.id).sort()).toEqual([a, b].sort())

    await svc.updateTask(listId, a, { title: 'a2' })
    await svc.deleteTask(listId, b)
    const next = await svc.tasksDelta(listId, initial.deltaLink)
    expect(next.changed.map((t) => t.title)).toEqual(['a2'])
    expect(next.removedIds).toEqual([b])
  })

  it('manages steps', async () => {
    const listId = fake.addList('L')
    const taskId = fake.addTask(listId, { title: 't' })
    const step = await svc.createStep(listId, taskId, { displayName: 'one' })
    await svc.updateStep(listId, taskId, step.id!, { isChecked: true })
    expect(fake.task(listId, taskId)?.checklistItems[0].isChecked).toBe(true)
    await svc.deleteStep(listId, taskId, step.id!)
    expect(fake.task(listId, taskId)?.checklistItems).toHaveLength(0)
  })

  it('uploads, lists, downloads and deletes small attachments', async () => {
    const listId = fake.addList('L')
    const taskId = fake.addTask(listId, { title: 't' })
    await svc.uploadAttachment(listId, taskId, new Blob(['hello'], { type: 'text/plain' }), 'hello.txt')
    const [meta] = await svc.getAttachments(listId, taskId)
    expect(meta).toMatchObject({ name: 'hello.txt', contentType: 'text/plain', size: 5 })
    const blob = await svc.downloadAttachment(listId, taskId, meta.id!)
    expect(await blob.text()).toBe('hello')
    await svc.deleteAttachment(listId, taskId, meta.id!)
    expect(await svc.getAttachments(listId, taskId)).toHaveLength(0)
  })

  it('retries throttled requests (429 with Retry-After)', async () => {
    fake.addList('L')
    fake.failNext('GET', /\/me\/todo\/lists$/, 429, 1)
    const lists = await svc.getLists()
    expect(lists).toHaveLength(1)
  })

  it('surfaces 404s as GraphErrors', async () => {
    const listId = fake.addList('L')
    await expect(svc.updateTask(listId, 'missing', { title: 'x' })).rejects.toSatisfy(isNotFound)
  })

  it('degrades gracefully for profile photo and categories', async () => {
    expect(await svc.getMyPhoto()).toBeNull()
    expect(await svc.getCategories()).toEqual([{ id: 'C1', displayName: 'Red category', color: 'preset0' }])
  })
})
