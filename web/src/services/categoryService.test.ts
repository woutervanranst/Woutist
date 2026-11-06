import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FakeGraph } from '../test/fakeGraph'
import { CategoryError, CategoryService } from './categoryService'
import { WoutistDb } from './db'
import { createGraphClient } from './graphClient'
import { TodoRepository } from './repository'
import { SyncEngine } from './sync/syncEngine'
import { TaskService } from './taskService'

const server = setupServer()
let fake: FakeGraph
let db: WoutistDb
let engine: SyncEngine
let service: CategoryService
let listId: string
let dbCounter = 0

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())
beforeEach(async () => {
  fake = new FakeGraph()
  server.resetHandlers(...fake.handlers())
  db = new WoutistDb(`test-categories-${++dbCounter}`)
  const svc = new TaskService(createGraphClient(async () => 'token'), 'Europe/Brussels')
  engine = new SyncEngine(db, svc, 'Europe/Brussels')
  const repo = new TodoRepository(db) // flush is triggered explicitly in tests
  service = new CategoryService({ svc, engine, repo, db })
  listId = fake.addList('Tasks', { wellknownListName: 'defaultList' })
  fake.addTask(listId, { title: 'A', categories: ['Red category'] })
  fake.addTask(listId, { title: 'B', categories: ['Red category', 'Other'] })
  fake.addTask(listId, { title: 'C', categories: [] })
  await engine.sync()
})
afterEach(() => {
  engine.stop()
  db.close()
  server.resetHandlers()
})

const names = async () => (await db.categories.toArray()).map((c) => c.displayName).sort()
const tagsOf = async (title: string) => (await db.tasks.filter((t) => t.title === title).first())!.categories
const red = async () => (await db.categories.get('Red category'))!

describe('CategoryService', () => {
  it('keeps the Graph id of each category', async () => {
    expect((await red()).id).toBe('C1')
  })

  it('creates a category', async () => {
    await service.create('  Errands ', 'preset7')
    expect(fake.categories.map((c) => [c.displayName, c.color])).toContainEqual(['Errands', 'preset7'])
    expect(await db.categories.get('Errands')).toMatchObject({ color: 'preset7' })
  })

  it('refuses an empty or duplicate name (ignoring case) without calling Graph', async () => {
    await expect(service.create('   ', 'preset0')).rejects.toBeInstanceOf(CategoryError)
    await expect(service.create('red CATEGORY', 'preset0')).rejects.toThrow('already exists')
    expect(fake.requests.filter((r) => r.method === 'POST' && r.url.pathname.includes('masterCategories'))).toEqual([])
  })

  it('recolors a category', async () => {
    await service.recolor(await red(), 'preset4')
    expect(fake.categories.find((c) => c.id === 'C1')?.color).toBe('preset4')
    expect((await red()).color).toBe('preset4')
  })

  describe('rename', () => {
    it('renames in place when Graph accepts it, and re-tags tasks', async () => {
      fake.categoryRename = 'applied'
      await service.rename(await red(), 'Crimson')
      expect(fake.categories.map((c) => [c.id, c.displayName])).toContainEqual(['C1', 'Crimson'])
      expect(await names()).toEqual(['Crimson'])
      expect(await tagsOf('A')).toEqual(['Crimson'])
      expect(await tagsOf('B')).toEqual(['Crimson', 'Other'])
      expect(await tagsOf('C')).toEqual([])
    })

    it('replaces the category when Graph answers 200 but keeps the old name (what the live API does)', async () => {
      const before = await red()
      await service.rename(before, 'Crimson')
      expect(fake.categories.map((c) => c.displayName)).toEqual(['Crimson'])
      expect(fake.categories[0].id).not.toBe('C1')
      expect(await names()).toEqual(['Crimson'])
      expect(await tagsOf('A')).toEqual(['Crimson'])
      expect(await tagsOf('B')).toEqual(['Crimson', 'Other'])
    })

    it('creates the new category and deletes the old one when Graph refuses', async () => {
      fake.categoryRename = 'refused'
      const before = await red()
      const renamed = await service.rename(before, 'Crimson')
      expect(renamed.id).not.toBe('C1')
      expect(fake.categories.map((c) => c.displayName)).toEqual(['Crimson'])
      expect(fake.categories[0].color).toBe(before.color)
      expect(await names()).toEqual(['Crimson'])
      expect(await tagsOf('A')).toEqual(['Crimson'])
      expect(await tagsOf('B')).toEqual(['Crimson', 'Other'])
    })

    it('queues the re-tagging so it also works offline', async () => {
      await service.rename(await red(), 'Crimson')
      const ops = (await db.outbox.toArray()).filter((o) => o.type === 'task.update')
      expect(ops).toHaveLength(2)
    })

    it('refuses a name that another category already has', async () => {
      await service.create('Blue', 'preset7')
      await expect(service.rename(await red(), 'blue')).rejects.toThrow('already exists')
      expect(await names()).toEqual(['Blue', 'Red category'])
    })

    it('edit changes name and color together', async () => {
      await service.edit(await red(), { name: 'Crimson', color: 'preset15' })
      expect(await db.categories.toArray()).toEqual([expect.objectContaining({ displayName: 'Crimson', color: 'preset15' })])
      expect(fake.categories).toEqual([expect.objectContaining({ displayName: 'Crimson', color: 'preset15' })])
    })
  })

  describe('delete', () => {
    it('counts the tasks that use a category', async () => {
      expect(await service.usage('Red category')).toBe(2)
      expect(await service.usage('Nope')).toBe(0)
    })

    it('removes the category and strips it from every task that has it', async () => {
      const removed = await service.remove(await red())
      expect(removed).toBe(2)
      expect(fake.categories).toEqual([])
      expect(await names()).toEqual([])
      expect(await tagsOf('A')).toEqual([])
      expect(await tagsOf('B')).toEqual(['Other'])
    })

    it('leaves tasks alone when Graph refuses the delete', async () => {
      fake.failNext('DELETE', /masterCategories/, 403)
      await expect(service.remove(await red())).rejects.toBeDefined()
      expect(await tagsOf('A')).toEqual(['Red category'])
      expect(await names()).toEqual(['Red category'])
    })
  })
})
