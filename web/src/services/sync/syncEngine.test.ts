import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FakeGraph } from '../../test/fakeGraph'
import { WoutistDb } from '../db'
import { createGraphClient } from '../graphClient'
import { TodoRepository } from '../repository'
import { TaskService } from '../taskService'
import { SyncEngine } from './syncEngine'

const server = setupServer()
let fake: FakeGraph
let db: WoutistDb
let engine: SyncEngine
let repo: TodoRepository
let dbCounter = 0

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())
beforeEach(async () => {
  fake = new FakeGraph()
  server.resetHandlers(...fake.handlers())
  db = new WoutistDb(`test-sync-${++dbCounter}`)
  const svc = new TaskService(createGraphClient(async () => 'token'), 'Europe/Brussels')
  engine = new SyncEngine(db, svc, 'Europe/Brussels')
  repo = new TodoRepository(db) // flush is triggered explicitly in tests
})
afterEach(async () => {
  engine.stop()
  db.close()
  server.resetHandlers()
})

const writes = () => fake.requests.filter((r) => r.method !== 'GET')

describe('SyncEngine pull', () => {
  it('pulls lists and tasks (with steps) on first sync', async () => {
    const tasksId = fake.addList('Tasks', { wellknownListName: 'defaultList' })
    const shopping = fake.addList('Shopping')
    fake.addTask(shopping, {
      title: 'Milk',
      importance: 'high',
      checklistItems: [{ displayName: 'oat', isChecked: false }],
    })
    await engine.sync()
    const lists = await db.lists.orderBy('sortIndex').toArray()
    expect(lists.map((l) => [l.id, l.displayName])).toEqual([
      [tasksId, 'Tasks'],
      [shopping, 'Shopping'],
    ])
    const [milk] = await db.tasks.where('listId').equals(shopping).toArray()
    expect(milk).toMatchObject({ title: 'Milk', important: 1 })
    expect(milk.steps.map((s) => s.displayName)).toEqual(['oat'])
    expect(engine.getStatus().state).toBe('idle')
  })

  it('picks up changes made in another client via delta, re-reading steps', async () => {
    const listId = fake.addList('L')
    const taskId = fake.addTask(listId, { title: 'Before' })
    await engine.sync()

    fake.serverUpdate(listId, taskId, {
      title: 'After',
      checklistItems: [{ id: 'S9', displayName: 'new step', isChecked: true }],
    })
    const other = fake.addTask(listId, { title: 'Added elsewhere' })
    await engine.sync()

    expect((await db.tasks.get(taskId))?.title).toBe('After')
    expect((await db.tasks.get(taskId))?.steps[0]?.displayName).toBe('new step')
    expect((await db.tasks.get(other))?.title).toBe('Added elsewhere')
    // Second sync used delta, not a full list read.
    const lastDelta = fake.requests.filter((r) => r.url.pathname.endsWith('/tasks/delta')).at(-1)!
    expect(lastDelta.url.searchParams.get('$deltatoken')).not.toBeNull()
  })

  it('removes tasks and lists deleted elsewhere', async () => {
    const keep = fake.addList('Keep')
    const gone = fake.addList('Gone')
    const t1 = fake.addTask(keep, { title: 'x' })
    fake.addTask(gone, { title: 'y' })
    await engine.sync()

    fake.serverDeleteTask(keep, t1)
    fake.serverDeleteList(gone)
    await engine.sync()

    expect(await db.tasks.get(t1)).toBeUndefined()
    expect(await db.lists.get(gone)).toBeUndefined()
    expect(await db.tasks.where('listId').equals(gone).count()).toBe(0)
  })

  it('never overwrites a task that has unsynced local changes', async () => {
    const listId = fake.addList('L')
    const taskId = fake.addTask(listId, { title: 'Server' })
    await engine.sync()

    fake.failNext('PATCH', /tasks\//, 0, 1) // network down for the push
    await repo.updateTask(taskId, { title: 'Local' })
    fake.serverUpdate(listId, taskId, { title: 'Server edit' })
    await engine.sync()
    expect((await db.tasks.get(taskId))?.title).toBe('Local')
    expect(await db.outbox.count()).toBe(1)
  })
})

describe('SyncEngine push', () => {
  it('creates a task with its latest local state and remaps the temp id', async () => {
    const listId = fake.addList('L')
    await engine.sync()

    const tempId = await repo.addTask(listId, 'Draft')
    await repo.updateTask(tempId, { title: 'Final title', importance: 'high' })
    await repo.addStep(tempId, 'first step')
    expect(await db.outbox.count()).toBe(2) // task.create + step.create; the edit is folded in

    await engine.flush()
    expect(await db.outbox.count()).toBe(0)
    expect(await db.tasks.get(tempId)).toBeUndefined()
    const realId = (await db.getMeta<string>(`alias:${tempId}`))!
    const serverTask = fake.task(listId, realId)!
    expect(serverTask).toMatchObject({ title: 'Final title', importance: 'high' })
    expect(serverTask.checklistItems.map((s) => s.displayName)).toEqual(['first step'])
    const local = (await db.tasks.get(realId))!
    expect(local.steps[0].id).toBe(serverTask.checklistItems[0].id)
  })

  it('sends field-level PATCHes only', async () => {
    const listId = fake.addList('L')
    const taskId = fake.addTask(listId, { title: 'T', categories: ['Red category'] })
    await engine.sync()
    await repo.toggleImportant(taskId)
    await engine.flush()
    const patch = writes().at(-1)!
    expect(patch.method).toBe('PATCH')
    expect(patch.body).toEqual({ importance: 'high' })
    expect(fake.task(listId, taskId)?.categories).toEqual(['Red category'])
  })

  it('drops all operations for a task deleted before it was synced', async () => {
    const listId = fake.addList('L')
    await engine.sync()
    const before = writes().length
    const tempId = await repo.addTask(listId, 'oops')
    await repo.addStep(tempId, 'step')
    await repo.deleteTask(tempId)
    await engine.flush()
    expect(writes().length).toBe(before)
    expect(await db.outbox.count()).toBe(0)
  })

  it('creates a new list and the tasks added to it while offline', async () => {
    await engine.sync()
    const tempList = await repo.createList('Holiday 🏖️')
    const tempTask = await repo.addTask(tempList, 'Book flights', { dueDate: '2026-12-01' })
    await engine.flush()

    const realList = (await db.getMeta<string>(`alias:${tempList}`))!
    const realTask = (await db.getMeta<string>(`alias:${tempTask}`))!
    expect(fake.lists.get(realList)?.list.displayName).toBe('Holiday 🏖️')
    expect(fake.task(realList, realTask)?.dueDateTime).toEqual({
      dateTime: '2026-12-01T00:00:00',
      timeZone: 'Europe/Brussels',
    })
    expect((await db.tasks.get(realTask))?.listId).toBe(realList)
  })

  it('keeps changes queued while offline and retries with backoff', async () => {
    const listId = fake.addList('L')
    const taskId = fake.addTask(listId, { title: 'T' })
    await engine.sync()

    fake.failNext('PATCH', /tasks\//, 0, 1)
    await repo.toggleCompleted(taskId)
    await engine.flush()
    const [queued] = await db.outbox.toArray()
    expect(queued.attempts).toBe(1)
    expect(queued.nextAttemptAt).toBeGreaterThan(Date.now())
    expect(engine.getStatus().state).toBe('offline')

    await db.outbox.update(queued.seq!, { nextAttemptAt: 0 }) // skip the wait
    await engine.flush()
    expect(await db.outbox.count()).toBe(0)
    expect(fake.task(listId, taskId)?.status).toBe('completed')
  })

  it('drops the local task when the server says it no longer exists', async () => {
    const listId = fake.addList('L')
    const taskId = fake.addTask(listId, { title: 'T' })
    await engine.sync()
    fake.serverDeleteTask(listId, taskId)
    await repo.updateTask(taskId, { title: 'edited' })
    await engine.flush()
    expect(await db.tasks.get(taskId)).toBeUndefined()
    expect(await db.outbox.count()).toBe(0)
  })

  it('moves a task to another list with its steps and attachments', async () => {
    const from = fake.addList('From')
    const to = fake.addList('To')
    const taskId = fake.addTask(from, {
      title: 'Move me',
      importance: 'high',
      checklistItems: [{ displayName: 'keep me', isChecked: true }],
    })
    await engine.sync()
    const attId = await repo.addAttachment(taskId, new Blob(['data'], { type: 'text/plain' }), 'a.txt')
    await engine.flush()
    expect(await db.attachments.get(attId)).toBeUndefined() // replaced by server metadata

    const movedTemp = await repo.moveTask(taskId, to)
    await engine.flush()

    const movedId = (await db.getMeta<string>(`alias:${movedTemp}`))!
    expect(fake.task(from, taskId)).toBeUndefined()
    const moved = fake.task(to, movedId)!
    expect(moved).toMatchObject({ title: 'Move me', importance: 'high', hasAttachments: true })
    expect(moved.checklistItems).toMatchObject([{ displayName: 'keep me', isChecked: true }])
    const atts = await db.attachments.where('taskId').equals(movedId).toArray()
    expect(atts.map((a) => a.name)).toEqual(['a.txt'])
  })

  it('creates, renames and deletes lists', async () => {
    const existing = fake.addList('Old name')
    await engine.sync()
    await repo.renameList(existing, 'New name')
    const temp = await repo.createList('Temp')
    await engine.flush()
    expect(fake.lists.get(existing)?.list.displayName).toBe('New name')
    const real = (await db.getMeta<string>(`alias:${temp}`))!
    await repo.deleteList(real)
    await engine.flush()
    expect(fake.lists.has(real)).toBe(false)
  })
})
