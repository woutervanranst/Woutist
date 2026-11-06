import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FakeGraph } from '../../test/fakeGraph'
import { createGraphClient } from '../graphClient'
import { TaskService } from '../taskService'
import { GraphSubscriptions, SUBSCRIPTION_MINUTES } from './graphSubscriptions'

const server = setupServer()
let fake: FakeGraph
let subs: GraphSubscriptions
let nowMs: number

const HOOK = { notificationUrl: 'https://api.test/api/graph-notify?u=user', clientState: 'state-123' }
const HOUR = 60 * 60 * 1000

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  fake = new FakeGraph()
  server.resetHandlers(...fake.handlers())
  nowMs = Date.parse('2026-11-06T10:00:00.000Z')
  const svc = new TaskService(createGraphClient(async () => 'token'), 'Europe/Brussels')
  subs = new GraphSubscriptions({ svc, getHook: async () => HOOK, now: () => nowMs })
})
afterEach(() => server.resetHandlers())

const writes = () => fake.requests.filter((r) => r.method !== 'GET' && r.url.pathname.includes('/subscriptions'))
const resourceOf = (listId: string) => `/me/todo/lists/${encodeURIComponent(listId)}/tasks`

describe('GraphSubscriptions.ensure', () => {
  it('creates one subscription per list for the hook', async () => {
    const result = await subs.ensure(['L1', 'AQMk+/='])
    expect(result).toEqual({ created: 2, renewed: 0, deleted: 0, failed: 0 })
    const created = [...fake.subscriptions.values()]
    expect(created.map((s) => s.resource).sort()).toEqual([resourceOf('AQMk+/='), resourceOf('L1')].sort())
    expect(created[0]).toMatchObject({
      changeType: 'created,updated,deleted',
      notificationUrl: HOOK.notificationUrl,
      clientState: HOOK.clientState,
      expirationDateTime: new Date(nowMs + SUBSCRIPTION_MINUTES * 60_000).toISOString(),
    })
  })

  it('leaves fresh subscriptions alone', async () => {
    await subs.ensure(['L1'])
    const before = writes().length
    nowMs += 12 * HOUR
    expect(await subs.ensure(['L1'])).toEqual({ created: 0, renewed: 0, deleted: 0, failed: 0 })
    expect(writes()).toHaveLength(before)
  })

  it('renews subscriptions that expire within 36 hours', async () => {
    await subs.ensure(['L1'])
    nowMs += 40 * HOUR
    expect(await subs.ensure(['L1'])).toMatchObject({ renewed: 1, created: 0 })
    expect([...fake.subscriptions.values()][0]!.expirationDateTime).toBe(
      new Date(nowMs + SUBSCRIPTION_MINUTES * 60_000).toISOString(),
    )
  })

  it('replaces a subscription that has already expired', async () => {
    await subs.ensure(['L1'])
    const [old] = [...fake.subscriptions.values()]
    nowMs += 80 * HOUR
    expect(await subs.ensure(['L1'])).toMatchObject({ created: 1, deleted: 1 })
    expect(fake.subscriptions.has(old!.id)).toBe(false)
  })

  it('deletes subscriptions for lists that are gone, and duplicates', async () => {
    await subs.ensure(['L1', 'L2'])
    // Another device raced us and created a second one for L1.
    fake.subscriptions.set('dup', { ...[...fake.subscriptions.values()][0]!, id: 'dup' })
    expect(await subs.ensure(['L1'])).toMatchObject({ deleted: 2, created: 0 })
    expect([...fake.subscriptions.values()].map((s) => s.resource)).toEqual([resourceOf('L1')])
  })

  it("ignores another environment's subscriptions", async () => {
    fake.subscriptions.set('prod', {
      id: 'prod',
      resource: resourceOf('L9'),
      changeType: 'created,updated,deleted',
      notificationUrl: 'https://prod.example/api/graph-notify?u=user',
      clientState: null,
      expirationDateTime: new Date(nowMs + HOUR).toISOString(),
    })
    await subs.ensure(['L1'])
    expect(fake.subscriptions.has('prod')).toBe(true)
    expect(fake.subscriptions.get('prod')!.expirationDateTime).toBe(new Date(nowMs + HOUR).toISOString())
  })

  it('keeps going when one list fails', async () => {
    fake.failNext('POST', /\/subscriptions$/, 400)
    expect(await subs.ensure(['L1', 'L2'])).toMatchObject({ created: 1, failed: 1 })
  })
})
