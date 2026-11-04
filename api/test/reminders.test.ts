import { describe, expect, it } from 'vitest'
import { LIMITS, type ReminderDto } from '@woutist/contracts'
import { handlePutReminders } from '../src/handlers/api'
import { bucketOf, encodeId, scheduleRowKey } from '../src/lib/keys'
import { reconcileReminders } from '../src/services/reminders'
import { createTestContext, KEY_A, KEY_B, makeRequest } from './helpers'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

describe('PUT /api/reminders', () => {
  it('schedules new reminders in minute buckets and stores only ids and times', async () => {
    const { deps, store, issuer, clock } = await createTestContext('2026-11-05T10:00:00.000Z')
    const reminders: ReminderDto[] = [
      { taskId: 'AAMkAD/task+1==', listId: 'list-1', fireAt: '2026-11-05T11:30:00.000Z' },
      { taskId: 'task-2', listId: 'list-2', fireAt: '2026-11-06T09:15:42+02:00' },
    ]
    const response = await handlePutReminders(makeRequest({ token: await issuer.token(), body: { reminders } }), deps)
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({ scheduled: 2, removed: 0, skipped: 0 })

    const rk1 = encodeId('AAMkAD/task+1==')
    expect(rk1).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(await store.reminders.get(KEY_A, rk1)).toEqual({
      partitionKey: KEY_A,
      rowKey: rk1,
      taskId: 'AAMkAD/task+1==',
      listId: 'list-1',
      fireAt: '2026-11-05T11:30:00.000Z',
      bucket: '202611051130',
    })
    expect(await store.schedule.get('202611051130', scheduleRowKey(KEY_A, rk1))).toEqual({
      partitionKey: '202611051130',
      rowKey: `${KEY_A}|${rk1}`,
      userKey: KEY_A,
      taskId: 'AAMkAD/task+1==',
      listId: 'list-1',
      fireAt: '2026-11-05T11:30:00.000Z',
    })
    // Offsets are normalised to UTC.
    expect(await store.schedule.listPartition('202611060715')).toHaveLength(1)
    expect((await store.reminders.get(KEY_A, encodeId('task-2')))?.fireAt).toBe('2026-11-06T07:15:42.000Z')
    expect(clock.now().toISOString()).toBe('2026-11-05T10:00:00.000Z')
  })

  it('moves the schedule row when fireAt changes', async () => {
    const { store, clock } = await createTestContext()
    const now = clock.now()
    await reconcileReminders(store, KEY_A, [{ taskId: 't', listId: 'l', fireAt: '2026-11-05T12:00:00Z' }], now)
    const result = await reconcileReminders(store, KEY_A, [{ taskId: 't', listId: 'l', fireAt: '2026-11-05T13:05:00Z' }], now)
    expect(result).toEqual({ scheduled: 1, removed: 0, skipped: 0 })
    expect(store.schedule.all().map((r) => r.partitionKey)).toEqual(['202611051305'])
    expect((await store.reminders.get(KEY_A, encodeId('t')))).toMatchObject({ fireAt: '2026-11-05T13:05:00.000Z', bucket: '202611051305' })
  })

  it('keeps the schedule row when fireAt changes within the same minute', async () => {
    const { store, clock } = await createTestContext()
    await reconcileReminders(store, KEY_A, [{ taskId: 't', listId: 'l', fireAt: '2026-11-05T12:00:00Z' }], clock.now())
    await reconcileReminders(store, KEY_A, [{ taskId: 't', listId: 'l', fireAt: '2026-11-05T12:00:30Z' }], clock.now())
    expect(store.schedule.all()).toEqual([expect.objectContaining({ partitionKey: '202611051200', fireAt: '2026-11-05T12:00:30.000Z' })])
  })

  it('updates the list id in place when a task moves to another list', async () => {
    const { store, clock } = await createTestContext()
    await reconcileReminders(store, KEY_A, [{ taskId: 't', listId: 'old', fireAt: '2026-11-05T12:00:00Z' }], clock.now())
    await reconcileReminders(store, KEY_A, [{ taskId: 't', listId: 'new', fireAt: '2026-11-05T12:00:00Z' }], clock.now())
    expect(store.schedule.all()).toEqual([expect.objectContaining({ partitionKey: '202611051200', listId: 'new' })])
    expect(store.reminders.all()).toEqual([expect.objectContaining({ listId: 'new', bucket: '202611051200' })])
  })

  it('is idempotent for an unchanged set', async () => {
    const { store, clock } = await createTestContext()
    const set = [{ taskId: 't', listId: 'l', fireAt: '2026-11-05T12:00:00Z' }]
    await reconcileReminders(store, KEY_A, set, clock.now())
    const before = { reminders: store.reminders.all(), schedule: store.schedule.all() }
    clock.advance(30 * MINUTE)
    expect(await reconcileReminders(store, KEY_A, set, clock.now())).toEqual({ scheduled: 1, removed: 0, skipped: 0 })
    expect({ reminders: store.reminders.all(), schedule: store.schedule.all() }).toEqual(before)
  })

  it('removes reminders (and their schedule rows) that are no longer in the set', async () => {
    const { store, clock } = await createTestContext()
    await reconcileReminders(
      store,
      KEY_A,
      [
        { taskId: 'keep', listId: 'l', fireAt: '2026-11-05T12:00:00Z' },
        { taskId: 'drop', listId: 'l', fireAt: '2026-11-05T13:00:00Z' },
      ],
      clock.now(),
    )
    const result = await reconcileReminders(store, KEY_A, [{ taskId: 'keep', listId: 'l', fireAt: '2026-11-05T12:00:00Z' }], clock.now())
    expect(result).toEqual({ scheduled: 1, removed: 1, skipped: 0 })
    expect(store.reminders.all().map((r) => r.taskId)).toEqual(['keep'])
    expect(store.schedule.all().map((r) => r.taskId)).toEqual(['keep'])

    expect(await reconcileReminders(store, KEY_A, [], clock.now())).toEqual({ scheduled: 0, removed: 1, skipped: 0 })
    expect(store.reminders.all()).toEqual([])
    expect(store.schedule.all()).toEqual([])
  })

  it('only schedules fire times within (now - 1 minute, now + 90 days]', async () => {
    const { store, clock } = await createTestContext('2026-11-05T10:00:20.000Z')
    const result = await reconcileReminders(
      store,
      KEY_A,
      [
        { taskId: 'too-old', listId: 'l', fireAt: clock.plus(-2 * MINUTE) },
        { taskId: 'edge-old', listId: 'l', fireAt: clock.plus(-MINUTE) },
        { taskId: 'grace', listId: 'l', fireAt: clock.plus(-30_000) },
        { taskId: 'this-minute', listId: 'l', fireAt: clock.plus(10_000) },
        { taskId: 'horizon', listId: 'l', fireAt: clock.plus(LIMITS.reminderHorizonDays * DAY) },
        { taskId: 'beyond', listId: 'l', fireAt: clock.plus(LIMITS.reminderHorizonDays * DAY + 1) },
      ],
      clock.now(),
    )
    expect(result).toEqual({ scheduled: 3, removed: 0, skipped: 3 })
    const byTask = new Map(store.reminders.all().map((r) => [r.taskId, r]))
    expect([...byTask.keys()].sort()).toEqual(['grace', 'horizon', 'this-minute'])
    // Due now or in the grace period: scheduled for the next minute, which the timer has not processed yet.
    expect(byTask.get('grace')?.bucket).toBe('202611051001')
    expect(byTask.get('this-minute')?.bucket).toBe('202611051001')
    expect(byTask.get('grace')?.fireAt).toBe('2026-11-05T09:59:50.000Z')
  })

  it('skips invalid entries instead of failing the request', async () => {
    const { store, clock } = await createTestContext()
    const fireAt = clock.plus(DAY)
    const result = await reconcileReminders(
      store,
      KEY_A,
      [
        null,
        'x',
        { taskId: 't1', listId: 'l' },
        { taskId: '', listId: 'l', fireAt },
        { taskId: 't2', listId: 'l', fireAt: 'tomorrow' },
        { taskId: 't3', listId: 'l', fireAt: '2026-11-06 10:00' },
        { taskId: 't4', listId: 42, fireAt },
        { taskId: 'has space', listId: 'l', fireAt },
        { taskId: 'x'.repeat(257), listId: 'l', fireAt },
        { taskId: 'ok', listId: 'l', fireAt },
      ],
      clock.now(),
    )
    expect(result).toEqual({ scheduled: 1, removed: 0, skipped: 9 })
  })

  it('dedupes by taskId, keeping the earliest fire time', async () => {
    const { store, clock } = await createTestContext()
    const result = await reconcileReminders(
      store,
      KEY_A,
      [
        { taskId: 't', listId: 'l', fireAt: '2026-11-05T15:00:00Z' },
        { taskId: 't', listId: 'l', fireAt: '2026-11-05T12:00:00Z' },
        { taskId: 't', listId: 'l', fireAt: '2026-11-05T13:00:00Z' },
      ],
      clock.now(),
    )
    expect(result).toEqual({ scheduled: 1, removed: 0, skipped: 2 })
    expect(store.reminders.all()).toEqual([expect.objectContaining({ fireAt: '2026-11-05T12:00:00.000Z' })])
    expect(store.schedule.all()).toHaveLength(1)
  })

  it(`keeps the ${LIMITS.maxRemindersPerUser} earliest reminders and counts the rest as skipped`, async () => {
    const { store, clock } = await createTestContext()
    const total = LIMITS.maxRemindersPerUser + 5
    // Shuffled order: latest first.
    const entries = Array.from({ length: total }, (_, i) => ({
      taskId: `task-${total - 1 - i}`,
      listId: 'l',
      fireAt: clock.plus((total - i) * MINUTE),
    }))
    const result = await reconcileReminders(store, KEY_A, entries, clock.now())
    expect(result).toEqual({ scheduled: LIMITS.maxRemindersPerUser, removed: 0, skipped: 5 })
    const ids = new Set(store.reminders.all().map((r) => r.taskId))
    expect(ids.size).toBe(LIMITS.maxRemindersPerUser)
    expect(ids.has('task-0')).toBe(true)
    expect(ids.has(`task-${LIMITS.maxRemindersPerUser - 1}`)).toBe(true)
    expect(ids.has(`task-${LIMITS.maxRemindersPerUser}`)).toBe(false)
    expect(store.schedule.all()).toHaveLength(LIMITS.maxRemindersPerUser)
  })

  it("never touches another user's rows", async () => {
    const { deps, store, issuer, clock } = await createTestContext()
    // Same task id for both users: keys must not collide.
    const shared = { taskId: 'same-task', listId: 'l', fireAt: clock.plus(DAY) }
    await reconcileReminders(store, KEY_B, [shared, { taskId: 'b-only', listId: 'l', fireAt: clock.plus(2 * DAY) }], clock.now())
    const before = { reminders: await store.reminders.listPartition(KEY_B), schedule: store.schedule.all() }

    const token = await issuer.token()
    await handlePutReminders(makeRequest({ token, body: { reminders: [{ ...shared, fireAt: clock.plus(3 * DAY) }] } }), deps)
    const response = await handlePutReminders(makeRequest({ token, body: { reminders: [] } }), deps)
    expect(response.jsonBody).toEqual({ scheduled: 0, removed: 1, skipped: 0 })

    expect(await store.reminders.listPartition(KEY_A)).toEqual([])
    expect(await store.reminders.listPartition(KEY_B)).toEqual(before.reminders)
    expect(store.schedule.all()).toEqual(before.schedule)
  })

  it('rejects a body without a reminders array', async () => {
    const { deps, issuer } = await createTestContext()
    const token = await issuer.token()
    for (const body of [{}, { reminders: {} }, [], 'x']) {
      const response = await handlePutReminders(makeRequest({ token, body }), deps)
      expect(response.status).toBe(400)
      expect(response.jsonBody).toMatchObject({ error: 'bad_request' })
    }
    expect((await handlePutReminders(makeRequest({ token, rawBody: '' }), deps)).status).toBe(400)
  })

  it('computes UTC minute buckets', () => {
    expect(bucketOf(new Date('2026-01-02T03:04:59.999Z'))).toBe('202601020304')
  })
})
