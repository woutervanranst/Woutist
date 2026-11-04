import { describe, expect, it } from 'vitest'
import { handleDeleteMe } from '../src/handlers/api'
import { reconcileReminders } from '../src/services/reminders'
import { upsertSubscription } from '../src/services/subscriptions'
import { createTestContext, KEY_A, KEY_B, makeRequest, makeSubscription } from './helpers'

describe('DELETE /api/me', () => {
  it("wipes the caller's subscriptions, reminders and schedule rows, and nothing else", async () => {
    const { deps, store, issuer, clock } = await createTestContext()
    const now = clock.now()
    const shared = makeSubscription()
    for (const key of [KEY_A, KEY_B]) {
      await upsertSubscription(store, key, shared, now)
      await upsertSubscription(store, key, makeSubscription(), now)
      await reconcileReminders(
        store,
        key,
        [
          { taskId: 'same-task', listId: 'l', fireAt: clock.plus(60 * 60_000) },
          { taskId: `only-${key}`, listId: 'l', fireAt: clock.plus(2 * 60 * 60_000) },
        ],
        now,
      )
    }
    const before = {
      subscriptions: await store.subscriptions.listPartition(KEY_B),
      reminders: await store.reminders.listPartition(KEY_B),
      schedule: store.schedule.all().filter((r) => r.userKey === KEY_B),
    }
    expect(store.schedule.all()).toHaveLength(4)

    const response = await handleDeleteMe(makeRequest({ method: 'DELETE', token: await issuer.token() }), deps)
    expect(response.status).toBe(204)

    expect(await store.subscriptions.listPartition(KEY_A)).toEqual([])
    expect(await store.reminders.listPartition(KEY_A)).toEqual([])
    expect(store.schedule.all().filter((r) => r.userKey === KEY_A)).toEqual([])

    expect(await store.subscriptions.listPartition(KEY_B)).toEqual(before.subscriptions)
    expect(await store.reminders.listPartition(KEY_B)).toEqual(before.reminders)
    expect(store.schedule.all()).toEqual(before.schedule)
  })

  it('is idempotent', async () => {
    const { deps, issuer } = await createTestContext()
    const token = await issuer.token()
    expect((await handleDeleteMe(makeRequest({ method: 'DELETE', token }), deps)).status).toBe(204)
    expect((await handleDeleteMe(makeRequest({ method: 'DELETE', token }), deps)).status).toBe(204)
  })
})
