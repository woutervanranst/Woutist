import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
let svc: TaskService
let repo: TodoRepository
let dbCounter = 0

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())
beforeEach(async () => {
  fake = new FakeGraph()
  server.resetHandlers(...fake.handlers())
  db = new WoutistDb(`test-sync-${++dbCounter}`)
  svc = new TaskService(createGraphClient(async () => 'token'), 'Europe/Brussels')
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
    await engine.sync({ reason: 'manual' })
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

  it('picks up changes made in another client via delta, including steps', async () => {
    const listId = fake.addList('L')
    const taskId = fake.addTask(listId, { title: 'Before' })
    await engine.sync({ reason: 'manual' })

    fake.serverUpdate(listId, taskId, {
      title: 'After',
      checklistItems: [{ id: 'S9', displayName: 'new step', isChecked: true }],
    })
    const other = fake.addTask(listId, { title: 'Added elsewhere' })
    await engine.sync({ reason: 'manual' })

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
    await engine.sync({ reason: 'manual' })

    fake.serverDeleteTask(keep, t1)
    fake.serverDeleteList(gone)
    await engine.sync({ reason: 'manual' })

    expect(await db.tasks.get(t1)).toBeUndefined()
    expect(await db.lists.get(gone)).toBeUndefined()
    expect(await db.tasks.where('listId').equals(gone).count()).toBe(0)
  })

  it('never overwrites a task that has unsynced local changes', async () => {
    const listId = fake.addList('L')
    const taskId = fake.addTask(listId, { title: 'Server' })
    await engine.sync({ reason: 'manual' })

    fake.failNext('PATCH', /tasks\//, 0, 1) // network down for the push
    await repo.updateTask(taskId, { title: 'Local' })
    fake.serverUpdate(listId, taskId, { title: 'Server edit' })
    await engine.sync({ reason: 'manual' })
    expect((await db.tasks.get(taskId))?.title).toBe('Local')
    expect(await db.outbox.count()).toBe(1)
  })
})

describe('SyncEngine pull: tasks without steps', () => {
  // Graph omits `checklistItems` for a task without steps, so a missing key means "no steps" (not "not included").
  const taskReads = (since = 0) =>
    fake.requests
      .slice(since)
      .filter(
        (r) =>
          r.method === 'GET' &&
          /\/tasks(\/[^/]+)?$/.test(r.url.pathname) &&
          !r.url.pathname.endsWith('/tasks/delta'),
      )
      .map((r) => r.url.pathname.split('/lists/')[1]!)
  const deltaCalls = (since = 0) =>
    fake.requests.slice(since).filter((r) => r.method === 'GET' && r.url.pathname.endsWith('/tasks/delta'))

  it('does not re-read many changed tasks without steps', async () => {
    const listId = fake.addList('L')
    const ids = Array.from({ length: 30 }, (_, i) => fake.addTask(listId, { title: `t${i}` }))
    await engine.sync({ reason: 'manual' })

    for (const id of ids) fake.serverUpdate(listId, id, { title: 'changed' })
    const before = fake.requests.length
    await engine.sync({ reason: 'manual' })

    expect(taskReads(before)).toEqual([])
    expect(deltaCalls(before)).toHaveLength(1)
    expect((await db.tasks.get(ids[7]!))?.title).toBe('changed')
  })

  it('does not read a few changed tasks without steps one by one', async () => {
    const listId = fake.addList('L')
    const ids = [1, 2, 3].map((i) => fake.addTask(listId, { title: `t${i}` }))
    await engine.sync({ reason: 'manual' })

    for (const id of ids) fake.serverUpdate(listId, id, { title: 'changed' })
    const before = fake.requests.length
    await engine.sync({ reason: 'manual' })

    expect(taskReads(before)).toEqual([])
    expect((await db.tasks.get(ids[0]!))?.title).toBe('changed')
  })

  it('re-reads a task with synced local steps that arrives without any (steps deleted elsewhere)', async () => {
    const listId = fake.addList('L')
    const withSteps = fake.addTask(listId, {
      title: 'Steps',
      checklistItems: [{ displayName: 'a', isChecked: false }],
    })
    const stepless = fake.addTask(listId, { title: 'Plain' })
    await engine.sync({ reason: 'manual' })
    expect((await db.tasks.get(withSteps))?.steps).toHaveLength(1)

    fake.serverUpdate(listId, withSteps, { title: 'Steps gone', checklistItems: [] })
    fake.serverUpdate(listId, stepless, { title: 'Plain 2' })
    const before = fake.requests.length
    await engine.sync({ reason: 'manual' })

    expect(taskReads(before)).toEqual([`${listId}/tasks/${withSteps}`])
    expect(await db.tasks.get(withSteps)).toMatchObject({ title: 'Steps gone', steps: [] })
    expect((await db.tasks.get(stepless))?.title).toBe('Plain 2')
  })

  it('re-reads the whole list once when many tasks with synced steps arrive without any', async () => {
    const listId = fake.addList('L')
    const ids = Array.from({ length: 25 }, (_, i) =>
      fake.addTask(listId, { title: `t${i}`, checklistItems: [{ displayName: 's', isChecked: false }] }),
    )
    await engine.sync({ reason: 'manual' })

    for (const id of ids) fake.serverUpdate(listId, id, { checklistItems: [] })
    const before = fake.requests.length
    await engine.sync({ reason: 'manual' })

    expect(taskReads(before)).toEqual([`${listId}/tasks`])
    expect((await db.tasks.where('listId').equals(listId).toArray()).flatMap((t) => t.steps)).toEqual([])
  })

  it('keeps unsynced local steps when the task arrives without steps, without re-reading', async () => {
    const listId = fake.addList('L')
    const taskId = fake.addTask(listId, { title: 'T' })
    await engine.sync({ reason: 'manual' })
    fake.failNext('POST', /checklistItems$/, 0, 1) // network down for the push
    await repo.addStep(taskId, 'local only')
    await engine.flush()
    const [tempStep] = (await db.tasks.get(taskId))!.steps
    expect(tempStep?.id).toMatch(/^tmp/)

    fake.serverUpdate(listId, taskId, { title: 'Server edit' })
    const before = fake.requests.length
    await engine.pullTasks(listId)

    expect(taskReads(before)).toEqual([])
    expect(await db.tasks.get(taskId)).toMatchObject({ steps: [{ displayName: 'local only' }] })
  })

  it('a full refresh reads each list once (after a quick pass)', async () => {
    const a = fake.addList('A')
    const b = fake.addList('B')
    for (let i = 0; i < 30; i++) fake.addTask(a, { title: `a${i}` })
    for (let i = 0; i < 3; i++) fake.addTask(b, { title: `b${i}` })
    await engine.sync({ reason: 'manual' })

    const before = fake.requests.length
    await engine.sync({ reason: 'manual-full' })

    expect(taskReads(before)).toEqual([])
    // Per list: the quick pass (delta from the stored link), then the full check (a fresh read).
    expect(deltaCalls(before)).toHaveLength(4)
    expect(await db.tasks.count()).toBe(33)
  })

  it('the first sync reads each list once, and a full refresh drops tasks deleted elsewhere', async () => {
    const listId = fake.addList('L')
    const keep = fake.addTask(listId, { title: 'keep' })
    const gone = fake.addTask(listId, { title: 'gone' })
    const before = fake.requests.length
    await engine.sync({ reason: 'manual' })
    expect(taskReads(before)).toEqual([])

    fake.serverDeleteTask(listId, gone)
    await engine.sync({ reason: 'manual-full' })
    expect(await db.tasks.get(gone)).toBeUndefined()
    expect(await db.tasks.get(keep)).toBeDefined()
  })
})

describe('SyncEngine targeted sync', () => {
  const deltaLists = (since: number) =>
    fake.requests
      .slice(since)
      .filter((r) => r.url.pathname.endsWith('/tasks/delta'))
      .map((r) => decodeURIComponent(r.url.pathname.split('/lists/')[1]!.split('/')[0]!))

  it('pulls only the named lists', async () => {
    const a = fake.addList('A')
    const b = fake.addList('B')
    const ta = fake.addTask(a, { title: 'a1' })
    const tb = fake.addTask(b, { title: 'b1' })
    await engine.sync({ reason: 'manual' })

    fake.serverUpdate(a, ta, { title: 'a2' })
    fake.serverUpdate(b, tb, { title: 'b2' })
    const before = fake.requests.length
    await engine.sync({ reason: 'signal', lists: [a] })

    expect(deltaLists(before)).toEqual([a])
    expect((await db.tasks.get(ta))?.title).toBe('a2')
    expect((await db.tasks.get(tb))?.title).toBe('b1')
  })

  it('ignores list ids that no longer exist', async () => {
    const a = fake.addList('A')
    await engine.sync({ reason: 'manual' })
    const before = fake.requests.length
    await engine.sync({ reason: 'signal', lists: ['gone', a] })
    expect(deltaLists(before)).toEqual([a])
    expect(engine.getStatus().state).toBe('idle')
  })

  it('merges requests made during a sync into one follow-up for those lists', async () => {
    const a = fake.addList('A')
    const b = fake.addList('B')
    const c = fake.addList('C')
    await engine.sync({ reason: 'manual' })

    const before = fake.requests.length
    const running = engine.sync({ reason: 'signal', lists: [c] })
    void engine.sync({ reason: 'signal', lists: [a] })
    void engine.sync({ reason: 'signal', lists: [b] })
    await running
    await vi.waitFor(() => expect(deltaLists(before)).toHaveLength(3))
    expect(deltaLists(before)).toEqual([c, a, b])
    await vi.waitFor(() => expect(engine.getStatus().state).toBe('idle'))
  })

  it('a full sync requested during a targeted one is not narrowed', async () => {
    const a = fake.addList('A')
    const b = fake.addList('B')
    await engine.sync({ reason: 'manual' })

    const before = fake.requests.length
    const running = engine.sync({ reason: 'signal', lists: [a] })
    void engine.sync({ reason: 'manual' })
    void engine.sync({ reason: 'signal', lists: [a] })
    await running
    await vi.waitFor(() => expect(deltaLists(before)).toHaveLength(3))
    expect(deltaLists(before).slice(1).sort()).toEqual([a, b].sort())
    await vi.waitFor(() => expect(engine.getStatus().state).toBe('idle'))
  })

  it("also pulls a list it hasn't read yet", async () => {
    const a = fake.addList('A')
    await engine.sync({ reason: 'manual' })
    const created = fake.addList('Created elsewhere')
    const task = fake.addTask(created, { title: 'new' })
    const before = fake.requests.length
    await engine.sync({ reason: 'signal', lists: [a] })
    expect(deltaLists(before).sort()).toEqual([a, created].sort())
    expect((await db.tasks.get(task))?.title).toBe('new')
  })
})

describe('SyncEngine push', () => {
  it('creates a task with its latest local state and remaps the temp id', async () => {
    const listId = fake.addList('L')
    await engine.sync({ reason: 'manual' })

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
    await engine.sync({ reason: 'manual' })
    await repo.toggleImportant(taskId)
    await engine.flush()
    const patch = writes().at(-1)!
    expect(patch.method).toBe('PATCH')
    expect(patch.body).toEqual({ importance: 'high' })
    expect(fake.task(listId, taskId)?.categories).toEqual(['Red category'])
  })

  it('drops all operations for a task deleted before it was synced', async () => {
    const listId = fake.addList('L')
    await engine.sync({ reason: 'manual' })
    const before = writes().length
    const tempId = await repo.addTask(listId, 'oops')
    await repo.addStep(tempId, 'step')
    await repo.deleteTask(tempId)
    await engine.flush()
    expect(writes().length).toBe(before)
    expect(await db.outbox.count()).toBe(0)
  })

  it('creates a new list and the tasks added to it while offline', async () => {
    await engine.sync({ reason: 'manual' })
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
    await engine.sync({ reason: 'manual' })

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
    await engine.sync({ reason: 'manual' })
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
    await engine.sync({ reason: 'manual' })
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
    await engine.sync({ reason: 'manual' })
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

describe('SyncEngine push: reordering steps', () => {
  const names = (steps: { displayName?: string | null }[]) => steps.map((s) => s.displayName)

  async function syncedTask(steps: string[]) {
    const listId = fake.addList('L')
    const taskId = fake.addTask(listId, { title: 'T', checklistItems: steps.map((displayName) => ({ displayName })) })
    await engine.sync({ reason: 'manual' })
    return { listId, taskId }
  }

  it('puts the steps on Graph in the new order and keeps the ones before the move', async () => {
    const { listId, taskId } = await syncedTask(['a', 'b', 'c', 'd'])
    const [a] = (await db.tasks.get(taskId))!.steps
    const b = (await db.tasks.get(taskId))!.steps[1]

    await repo.reorderSteps(taskId, b.id, 3) // a c d b
    expect(names((await db.tasks.get(taskId))!.steps)).toEqual(['a', 'c', 'd', 'b'])
    await engine.flush()

    expect(names(fake.task(listId, taskId)!.checklistItems)).toEqual(['a', 'c', 'd', 'b'])
    const local = (await db.tasks.get(taskId))!.steps
    expect(local.map((s) => s.id)).toEqual(fake.task(listId, taskId)!.checklistItems.map((s) => s.id))
    expect(local[0].id).toBe(a.id) // untouched, not re-created
    expect(writes().filter((r) => r.method === 'DELETE')).toHaveLength(3) // b, c, d
  })

  it('moves a step up and keeps whether it is checked', async () => {
    const { listId, taskId } = await syncedTask(['a', 'b', 'c'])
    const c = (await db.tasks.get(taskId))!.steps[2]
    await repo.updateStep(taskId, c.id, { isChecked: true })
    await engine.flush()
    const checked = (await db.tasks.get(taskId))!.steps[2]

    await repo.reorderSteps(taskId, checked.id, 0)
    await engine.flush()

    const server = fake.task(listId, taskId)!.checklistItems
    expect(names(server)).toEqual(['c', 'a', 'b'])
    expect(server.map((s) => s.isChecked)).toEqual([true, false, false])
  })

  it('does nothing when the step stays where it is', async () => {
    const { taskId } = await syncedTask(['a', 'b'])
    const [a] = (await db.tasks.get(taskId))!.steps
    await repo.reorderSteps(taskId, a.id, 0)
    expect(await db.outbox.count()).toBe(0)
  })

  it('reorders steps that are not on Graph yet without deleting anything there', async () => {
    const { listId, taskId } = await syncedTask(['a'])
    await repo.addStep(taskId, 'b')
    await repo.addStep(taskId, 'c')
    const b = (await db.tasks.get(taskId))!.steps[1]

    await repo.reorderSteps(taskId, b.id, 2) // a c b
    await engine.flush()

    expect(names(fake.task(listId, taskId)!.checklistItems)).toEqual(['a', 'c', 'b'])
    expect(writes().filter((r) => r.method === 'DELETE')).toHaveLength(0)
  })

  it('drops queued edits of a replaced step and keeps the edit in the new copy', async () => {
    const { listId, taskId } = await syncedTask(['a', 'b'])
    const [a] = (await db.tasks.get(taskId))!.steps
    await repo.updateStep(taskId, a.id, { displayName: 'a2' })
    await repo.reorderSteps(taskId, a.id, 1)
    await engine.flush()

    expect(names(fake.task(listId, taskId)!.checklistItems)).toEqual(['b', 'a2'])
  })

  it('a pull while the reorder is waiting does not bring the old steps back', async () => {
    const { listId, taskId } = await syncedTask(['a', 'b', 'c'])
    const [a] = (await db.tasks.get(taskId))!.steps
    await repo.reorderSteps(taskId, a.id, 2) // b c a, queued
    fake.serverUpdate(listId, taskId, { title: 'Server edit' })

    await engine.pullTasks(listId)

    expect(names((await db.tasks.get(taskId))!.steps)).toEqual(['b', 'c', 'a'])
    await engine.flush()
    expect(names(fake.task(listId, taskId)!.checklistItems)).toEqual(['b', 'c', 'a'])
  })
})

describe('SyncEngine sync log', () => {
  const logs = () => db.syncLog.orderBy('id').toArray()
  const lastLog = async () => (await logs()).at(-1)!

  it('records every run with the reason it was asked for', async () => {
    const listId = fake.addList('Work')
    fake.addTask(listId, { title: 'a' })
    await engine.sync({ reason: 'startup' })
    await engine.sync({ reason: 'interval' })
    await engine.sync({ reason: 'signal', lists: [listId] })

    const entries = await logs()
    expect(entries.map((e) => e.reason)).toEqual(['startup', 'interval', 'signal'])
    expect(entries.map((e) => e.result)).toEqual(['ok', 'ok', 'ok'])
    expect(entries[0]!.endedAt).toBeGreaterThanOrEqual(entries[0]!.startedAt)
    expect(entries[0]!.lists).toEqual([{ listId, name: 'Work', changed: 1, removed: 0 }])
  })

  it('a follow-up run keeps the most significant reason it was asked for', async () => {
    const a = fake.addList('A')
    await engine.sync({ reason: 'startup' })

    const running = engine.sync({ reason: 'interval' })
    void engine.sync({ reason: 'signal', lists: [a] })
    void engine.sync({ reason: 'manual' })
    void engine.sync({ reason: 'visible' })
    await running
    await vi.waitFor(async () => expect(await logs()).toHaveLength(3))
    expect((await logs()).map((e) => e.reason)).toEqual(['startup', 'interval', 'manual'])
  })

  it('a queued check-everything beats a queued manual sync, and runs a full check', async () => {
    const a = fake.addList('A')
    fake.addTask(a, { title: 't' })
    await engine.sync({ reason: 'startup' })

    const running = engine.sync({ reason: 'interval' })
    void engine.sync({ reason: 'manual-full' })
    void engine.sync({ reason: 'manual' })
    await running
    await vi.waitFor(async () => expect(await logs()).toHaveLength(3))
    expect(await lastLog()).toMatchObject({ reason: 'manual-full', full: true })
  })

  it('a quick pass applies a change to the database before the full check reads anything', async () => {
    const listId = fake.addList('L')
    const taskId = fake.addTask(listId, { title: 'Before' })
    await engine.sync({ reason: 'startup' })

    fake.serverUpdate(listId, taskId, { title: 'After' })
    let titleWhenFullCheckStarted: string | undefined
    fake.onRequest = async (r) => {
      const initialRound = r.url.pathname.endsWith('/tasks/delta') && !r.url.searchParams.has('$deltatoken')
      if (initialRound && titleWhenFullCheckStarted === undefined) titleWhenFullCheckStarted = (await db.tasks.get(taskId))?.title
    }
    await engine.sync({ reason: 'manual-full' })

    expect(titleWhenFullCheckStarted).toBe('After')
    expect(await lastLog()).toMatchObject({ full: true, lists: [{ changed: 1, removed: 0 }] })
  })

  it('reads each list once on the first sync (the quick pass already is a full read)', async () => {
    const listId = fake.addList('L')
    fake.addTask(listId, { title: 'a' })
    await engine.sync({ reason: 'startup' })
    const deltas = fake.requests.filter((r) => r.url.pathname.endsWith('/tasks/delta'))
    expect(deltas).toHaveLength(1)
    expect(await lastLog()).toMatchObject({ full: true, fullCheck: null })
    expect(await db.getMeta<number>('lastFullSyncAt')).toBeGreaterThan(0)
  })

  it('counts what changed and what was removed, per list', async () => {
    const work = fake.addList('Work')
    const home = fake.addList('Home')
    const w1 = fake.addTask(work, { title: 'w1' })
    const w2 = fake.addTask(work, { title: 'w2' })
    fake.addTask(home, { title: 'h1' })
    await engine.sync({ reason: 'startup' })

    fake.serverUpdate(work, w1, { title: 'w1 changed' })
    fake.serverDeleteTask(work, w2)
    fake.addTask(work, { title: 'w3' })
    await engine.sync({ reason: 'manual' })

    const entry = await lastLog()
    expect(entry.result).toBe('ok')
    expect(entry.lists).toEqual(
      expect.arrayContaining([
        { listId: work, name: 'Work', changed: 2, removed: 1 },
        { listId: home, name: 'Home', changed: 0, removed: 0 },
      ]),
    )
    expect(entry.full).toBe(false)
    expect(entry.fullCheck).toBeNull()
  })

  it('does not count our own edit coming back as something new, and counts it as sent', async () => {
    const listId = fake.addList('L')
    const taskId = fake.addTask(listId, { title: 'T' })
    await engine.sync({ reason: 'startup' })

    await repo.toggleImportant(taskId)
    await engine.sync({ reason: 'manual' })

    const entry = await lastLog()
    expect(entry.sent).toBe(1)
    expect(entry.lists).toEqual([{ listId, name: 'L', changed: 0, removed: 0 }])
  })

  it('counts requests to Microsoft during the run, nextLink pages included', async () => {
    fake.pageSize = 2
    const listId = fake.addList('L')
    for (let i = 0; i < 5; i++) fake.addTask(listId, { title: `t${i}` })
    const before = fake.requests.length
    await engine.sync({ reason: 'startup' })
    expect((await lastLog()).requests).toBe(fake.requests.length - before)
    expect((await lastLog()).requests).toBeGreaterThan(3)
  })

  it('finds no differences when the full check reads unchanged data', async () => {
    const listId = fake.addList('L')
    fake.addTask(listId, { title: 'a', checklistItems: [{ displayName: 's', isChecked: false }] })
    fake.addTask(listId, { title: 'b' })
    await engine.sync({ reason: 'startup' })
    await engine.sync({ reason: 'manual-full' })

    const entry = await lastLog()
    expect(entry.full).toBe(true)
    expect(entry.fullCheck).toMatchObject({ checked: 2, differences: 0 })
    expect(entry.fullCheck!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('counts the tasks the quick pass missed: changed, added and removed without a delta', async () => {
    const listId = fake.addList('L')
    const a = fake.addTask(listId, { title: 'a' })
    const b = fake.addTask(listId, { title: 'b' })
    await engine.sync({ reason: 'startup' })

    // Changes the delta feed never reports (what a missed notification looks like).
    fake.task(listId, a)!.title = 'a, changed quietly'
    fake.lists.get(listId)!.tasks.delete(b)
    fake.lists.get(listId)!.tasks.set('quiet', { ...fake.task(listId, a)!, id: 'quiet', title: 'added quietly' })
    await engine.sync({ reason: 'manual-full' })

    expect((await lastLog()).fullCheck).toMatchObject({ differences: 3 })
    expect((await db.tasks.get(a))?.title).toBe('a, changed quietly')
    expect(await db.tasks.get(b)).toBeUndefined()
    expect((await db.tasks.get('quiet'))?.title).toBe('added quietly')
  })

  const oldRun = (startedAt: number, reason: 'interval' | 'startup' = 'interval') => ({
    startedAt,
    endedAt: startedAt,
    reason,
    full: false,
    result: 'ok' as const,
    lists: [],
    changesMs: 0,
    fullCheck: null,
    sent: 0,
    requests: 0,
  })
  const HOUR = 60 * 60 * 1000

  it('keeps the runs of the last 24 hours and drops the older ones', async () => {
    fake.addList('L')
    const now = Date.now()
    await db.syncLog.bulkAdd([
      oldRun(now - 30 * HOUR),
      oldRun(now - 24 * HOUR - 60_000),
      oldRun(now - 23 * HOUR, 'startup'),
      oldRun(now - 2 * HOUR),
    ])
    await engine.sync({ reason: 'manual' })

    const entries = await logs()
    expect(entries.map((e) => e.reason)).toEqual(['startup', 'interval', 'manual'])
    expect(entries.every((e) => e.startedAt >= now - 24 * HOUR)).toBe(true)
  })

  it('caps the log at 500 runs, dropping the oldest', async () => {
    fake.addList('L')
    const now = Date.now()
    await db.syncLog.bulkAdd(Array.from({ length: 505 }, (_, i) => oldRun(now - 10 * HOUR + i)))
    await engine.sync({ reason: 'manual' })

    const entries = await logs()
    expect(entries).toHaveLength(500)
    expect(entries.at(-1)!.reason).toBe('manual')
    expect(entries[0]!.startedAt).toBe(now - 10 * HOUR + 6) // the 6 oldest are gone
  })

  it('records failures with their message, and offline runs as offline', async () => {
    fake.addList('L')
    fake.failNext('GET', /\/me\/todo\/lists$/, 500, 1)
    await engine.sync({ reason: 'visible' })
    expect(await lastLog()).toMatchObject({ reason: 'visible', result: 'offline' })
    expect((await lastLog()).error).toBeTruthy()

    fake.failNext('GET', /\/me\/todo\/lists$/, 403, 1)
    await engine.sync({ reason: 'manual' })
    expect(await lastLog()).toMatchObject({ result: 'error' })
    expect(engine.getStatus().state).toBe('error')
  })

  it('does not fail the sync when the log cannot be written', async () => {
    const listId = fake.addList('L')
    fake.addTask(listId, { title: 'a' })
    vi.spyOn(db.syncLog, 'add').mockRejectedValue(new Error('quota exceeded'))
    await expect(engine.sync({ reason: 'manual' })).resolves.toMatchObject({ result: 'ok' })
    expect(engine.getStatus().state).toBe('idle')
    expect(await db.tasks.count()).toBe(1)
  })

  it('does not fail the sync when old runs cannot be removed', async () => {
    const listId = fake.addList('L')
    fake.addTask(listId, { title: 'a' })
    vi.spyOn(db.syncLog, 'where').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    await expect(engine.sync({ reason: 'manual' })).resolves.toMatchObject({ result: 'ok' })
    expect(engine.getStatus().state).toBe('idle')
    expect(await db.tasks.count()).toBe(1)
  })
})

describe('SyncEngine status', () => {
  it('persists lastSyncAt and lastFullSyncAt, and a new engine starts with them', async () => {
    fake.addList('L')
    await engine.sync({ reason: 'startup' })
    const { lastSyncAt, lastFullSyncAt } = engine.getStatus()
    expect(lastSyncAt).toBeGreaterThan(0)
    expect(lastFullSyncAt).toBeGreaterThan(0)
    expect(await db.getMeta<number>('lastSyncAt')).toBe(lastSyncAt)

    const restarted = new SyncEngine(db, svc, 'Europe/Brussels')
    expect(restarted.getStatus().lastSyncAt).toBeNull()
    await restarted.load()
    expect(restarted.getStatus()).toMatchObject({ lastSyncAt, lastFullSyncAt, state: 'idle', progress: null })
  })

  it('does not move lastSyncAt when a sync fails', async () => {
    fake.addList('L')
    await engine.sync({ reason: 'startup' })
    const { lastSyncAt } = engine.getStatus()
    fake.failNext('GET', /\/me\/todo\/lists$/, 403, 1)
    await engine.sync({ reason: 'manual' })
    expect(engine.getStatus()).toMatchObject({ state: 'error', lastSyncAt, progress: null })
    expect(await db.getMeta<number>('lastSyncAt')).toBe(lastSyncAt)
  })

  it('says why it is syncing while it runs, and nothing when idle', async () => {
    fake.addList('L')
    const seen: (string | null)[] = []
    engine.subscribe((s) => seen.push(s.reason))
    await engine.sync({ reason: 'visible' })
    expect(seen).toContain('visible')
    expect(engine.getStatus().reason).toBeNull()
  })

  describe('progress', () => {
    const track = () => {
      const seen: ({ phase: string; done: number; total: number } | null)[] = []
      engine.subscribe((s) => seen.push(s.progress && { ...s.progress }))
      return seen
    }

    it('counts lists in the quick pass, then tasks in the full check, and is null when idle', async () => {
      engine = new SyncEngine(db, svc, 'Europe/Brussels', { progressIntervalMs: 0 })
      const a = fake.addList('A')
      const b = fake.addList('B')
      for (let i = 0; i < 3; i++) fake.addTask(a, { title: `a${i}` })
      for (let i = 0; i < 2; i++) fake.addTask(b, { title: `b${i}` })
      await engine.sync({ reason: 'startup' })

      const seen = track()
      await engine.sync({ reason: 'manual-full' })

      const changes = seen.filter((p) => p?.phase === 'changes')
      expect(changes.at(-1)).toEqual({ phase: 'changes', done: 2, total: 2 })
      expect(changes.map((p) => p!.done)).toEqual([...changes.map((p) => p!.done)].sort((x, y) => x - y))
      const full = seen.filter((p) => p?.phase === 'full')
      expect(full[0]).toEqual({ phase: 'full', done: 0, total: 5 })
      expect(full.at(-1)).toEqual({ phase: 'full', done: 5, total: 5 })
      expect(seen.indexOf(full[0]!)).toBeGreaterThan(seen.indexOf(changes.at(-1)!))
      expect(seen.at(-1)).toBeNull()
      expect(engine.getStatus().progress).toBeNull()
    })

    it('raises the total when more tasks arrive than were known', async () => {
      engine = new SyncEngine(db, svc, 'Europe/Brussels', { progressIntervalMs: 0 })
      const a = fake.addList('A')
      fake.addTask(a, { title: 'a' })
      await engine.sync({ reason: 'startup' })
      // Four tasks the quick pass won't report (no delta entry), so the local count is 1 and 5 arrive.
      const template = fake.task(a, fake.lists.get(a)!.tasks.keys().next().value!)!
      for (let i = 0; i < 4; i++) fake.lists.get(a)!.tasks.set(`q${i}`, { ...template, id: `q${i}`, title: `quiet${i}` })
      const seen = track()
      await engine.sync({ reason: 'manual-full' })
      expect(seen.filter((p) => p?.phase === 'full').at(-1)).toEqual({ phase: 'full', done: 5, total: 5 })
    })

    it('does not emit on every page', async () => {
      fake.pageSize = 1
      const a = fake.addList('A')
      for (let i = 0; i < 40; i++) fake.addTask(a, { title: `t${i}` })
      await engine.sync({ reason: 'startup' })
      const seen = track()
      await engine.sync({ reason: 'manual-full' })
      // 40 pages in the full check; at most one emission per 100 ms plus the phase changes.
      expect(seen.filter((p) => p?.phase === 'full').length).toBeLessThan(20)
      expect(seen.filter((p) => p?.phase === 'full').at(-1)).toEqual({ phase: 'full', done: 40, total: 40 })
    })
  })
})
