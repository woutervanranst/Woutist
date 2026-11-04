import { describe, expect, it } from 'vitest'
import type { ReminderPushPayload } from '@woutist/contracts'
import { bucketOf, encodeId, scheduleRowKey } from '../src/lib/keys'
import type { Store } from '../src/lib/tables'
import { reconcileReminders } from '../src/services/reminders'
import { CURSOR_PARTITION, CURSOR_ROW, sendDueReminders } from '../src/services/sendDueReminders'
import { upsertSubscription } from '../src/services/subscriptions'
import { createTestContext, fakePush, KEY_A, KEY_B, makeSubscription, type TestContext } from './helpers'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

async function cursorOf(store: Store): Promise<string | undefined> {
  return (await store.state.get(CURSOR_PARTITION, CURSOR_ROW))?.lastProcessedBucket
}

async function setCursor(store: Store, bucket: string): Promise<void> {
  await store.state.upsert({ partitionKey: CURSOR_PARTITION, rowKey: CURSOR_ROW, lastProcessedBucket: bucket })
}

function run(ctx: TestContext, send = fakePush()) {
  return { push: send, result: sendDueReminders({ store: ctx.store, now: ctx.clock.now, send: send.send, log: ctx.log }) }
}

describe('sendDueReminders', () => {
  it("sends a due reminder to all of the user's subscriptions, then deletes its rows", async () => {
    const ctx = await createTestContext('2026-11-05T10:00:00.000Z')
    const { store, clock } = ctx
    const phone = makeSubscription()
    const laptop = makeSubscription()
    await upsertSubscription(store, KEY_A, phone, clock.now())
    await upsertSubscription(store, KEY_A, laptop, clock.now())
    await upsertSubscription(store, KEY_B, makeSubscription(), clock.now())
    await reconcileReminders(store, KEY_A, [{ taskId: 'task/1', listId: 'list-1', fireAt: '2026-11-05T10:05:00Z' }], clock.now())
    await setCursor(store, '202611051004')

    clock.set('2026-11-05T10:05:00.300Z')
    const { push, result } = run(ctx)
    const summary = await result

    const expected: ReminderPushPayload = { type: 'reminder', taskId: 'task/1', listId: 'list-1', fireAt: '2026-11-05T10:05:00.000Z' }
    expect(push.calls.map((c) => c.endpoint).sort()).toEqual([phone.endpoint, laptop.endpoint].sort())
    for (const call of push.calls) expect(call.payload).toEqual(expected)
    expect(summary).toMatchObject({ delivered: 1, notifications: 2, cursor: '202611051005' })
    expect(store.schedule.all()).toEqual([])
    expect(store.reminders.all()).toEqual([])
    expect(await cursorOf(store)).toBe('202611051005')
  })

  it('does not send reminders whose bucket is in the future', async () => {
    const ctx = await createTestContext('2026-11-05T10:00:00.000Z')
    const { store, clock } = ctx
    await upsertSubscription(store, KEY_A, makeSubscription(), clock.now())
    await reconcileReminders(store, KEY_A, [{ taskId: 't', listId: 'l', fireAt: '2026-11-05T10:01:00Z' }], clock.now())

    clock.set('2026-11-05T10:00:59.999Z')
    const { push, result } = run(ctx)
    await result
    expect(push.calls).toEqual([])
    expect(store.schedule.all()).toHaveLength(1)
    expect(store.reminders.all()).toHaveLength(1)
    expect(await cursorOf(store)).toBe('202611051000')

    clock.set('2026-11-05T10:01:00.000Z')
    const second = run(ctx)
    await second.result
    expect(second.push.calls).toHaveLength(1)
  })

  it('catches up on missed buckets, but drops anything older than 24 hours', async () => {
    const ctx = await createTestContext('2026-11-04T06:00:00.000Z')
    const { store, clock } = ctx
    const now = Date.parse('2026-11-05T12:00:00.000Z')
    const at = (ms: number) => new Date(ms).toISOString()
    await upsertSubscription(store, KEY_A, makeSubscription(), clock.now())
    await reconcileReminders(
      store,
      KEY_A,
      [
        { taskId: '25h-ago', listId: 'l', fireAt: at(now - 25 * HOUR) },
        { taskId: '23h-ago', listId: 'l', fireAt: at(now - 23 * HOUR) },
        { taskId: '10m-ago', listId: 'l', fireAt: at(now - 10 * MINUTE) },
        { taskId: 'now', listId: 'l', fireAt: at(now) },
        { taskId: 'later', listId: 'l', fireAt: at(now + MINUTE) },
      ],
      clock.now(),
    )
    await setCursor(store, bucketOf(Date.parse('2026-11-04T06:00:00.000Z')))

    clock.set('2026-11-05T12:00:00.000Z')
    const { push, result } = run(ctx)
    const summary = await result
    const sent = push.calls.map((c) => (c.payload as ReminderPushPayload).taskId)
    expect(sent).toEqual(['23h-ago', '10m-ago', 'now'])
    expect(summary).toMatchObject({ delivered: 3, expired: 1, cursor: '202611051200' })
    expect(store.reminders.all().map((r) => r.taskId)).toEqual(['later'])
    expect(store.schedule.all().map((r) => r.taskId)).toEqual(['later'])
    expect(await cursorOf(store)).toBe('202611051200')

    // Nothing is sent twice.
    clock.advance(30_000)
    const again = run(ctx)
    await again.result
    expect(again.push.calls).toEqual([])
  })

  it('advances the cursor through empty minutes and starts one minute back when it has none', async () => {
    const ctx = await createTestContext('2026-11-05T10:00:00.000Z')
    const { store, clock } = ctx
    expect(await cursorOf(store)).toBeUndefined()
    const first = await run(ctx).result
    expect(first.fromBucket).toBe('202611050959')
    expect(await cursorOf(store)).toBe('202611051000')

    clock.advance(5 * MINUTE)
    await run(ctx).result
    expect(await cursorOf(store)).toBe('202611051005')
  })

  it('deletes subscriptions that the push service reports as gone (404/410) and keeps others on errors', async () => {
    const ctx = await createTestContext('2026-11-05T10:00:00.000Z')
    const { store, clock, log } = ctx
    const gone = makeSubscription()
    const notFound = makeSubscription()
    const flaky = makeSubscription()
    const healthy = makeSubscription()
    for (const sub of [gone, notFound, flaky, healthy]) await upsertSubscription(store, KEY_A, sub, clock.now())
    await reconcileReminders(
      store,
      KEY_A,
      [
        { taskId: 't1', listId: 'l', fireAt: '2026-11-05T10:02:00Z' },
        { taskId: 't2', listId: 'l', fireAt: '2026-11-05T10:03:00Z' },
      ],
      clock.now(),
    )

    const push = fakePush()
    push.responses.set(gone.endpoint, { ok: false, statusCode: 410, message: 'Gone' })
    push.responses.set(notFound.endpoint, { ok: false, statusCode: 404, message: 'Not Found' })
    push.responses.set(flaky.endpoint, { ok: false, statusCode: 500, message: 'Internal Server Error' })

    clock.set('2026-11-05T10:03:00.000Z')
    const summary = await run(ctx, push).result
    expect(summary).toMatchObject({ delivered: 2, subscriptionsRemoved: 2, pushFailures: 2, notifications: 2 })
    const remaining = (await store.subscriptions.listPartition(KEY_A)).map((s) => s.endpoint).sort()
    expect(remaining).toEqual([flaky.endpoint, healthy.endpoint].sort())
    // Gone subscriptions are not retried for the second reminder within the same run.
    expect(push.calls.filter((c) => c.endpoint === gone.endpoint)).toHaveLength(1)
    expect(push.calls.filter((c) => c.endpoint === healthy.endpoint)).toHaveLength(2)
    expect(log.messages.some((m) => m.level === 'warn' && m.message.includes('500'))).toBe(true)
    expect(store.schedule.all()).toEqual([])
  })

  it('drops schedule rows whose reminder was changed or deleted without sending', async () => {
    const ctx = await createTestContext('2026-11-05T10:00:00.000Z')
    const { store, clock } = ctx
    await upsertSubscription(store, KEY_A, makeSubscription(), clock.now())
    await reconcileReminders(store, KEY_A, [{ taskId: 'moved', listId: 'l', fireAt: '2026-11-05T11:00:00Z' }], clock.now())
    // Leftover schedule rows (e.g. a failed delete) for a moved and a deleted reminder.
    const rk = encodeId('moved')
    await store.schedule.upsert({
      partitionKey: '202611051001',
      rowKey: scheduleRowKey(KEY_A, rk),
      userKey: KEY_A,
      taskId: 'moved',
      listId: 'l',
      fireAt: '2026-11-05T10:01:00.000Z',
    })
    await store.schedule.upsert({
      partitionKey: '202611051001',
      rowKey: scheduleRowKey(KEY_A, encodeId('deleted')),
      userKey: KEY_A,
      taskId: 'deleted',
      listId: 'l',
      fireAt: '2026-11-05T10:01:00.000Z',
    })

    clock.set('2026-11-05T10:01:00.000Z')
    const { push, result } = run(ctx)
    expect(await result).toMatchObject({ stale: 2, delivered: 0 })
    expect(push.calls).toEqual([])
    expect(store.schedule.all().map((r) => r.partitionKey)).toEqual(['202611051100'])
    expect(await store.reminders.get(KEY_A, rk)).toMatchObject({ fireAt: '2026-11-05T11:00:00.000Z' })
  })

  it('does not advance the cursor past a bucket with a storage error, so the row is retried', async () => {
    const ctx = await createTestContext('2026-11-05T10:00:00.000Z')
    const { store, clock } = ctx
    await upsertSubscription(store, KEY_A, makeSubscription(), clock.now())
    await reconcileReminders(
      store,
      KEY_A,
      [
        { taskId: 'a', listId: 'l', fireAt: '2026-11-05T10:01:00Z' },
        { taskId: 'b', listId: 'l', fireAt: '2026-11-05T10:02:00Z' },
      ],
      clock.now(),
    )
    await setCursor(store, '202611051000')
    const originalDelete = store.schedule.delete.bind(store.schedule)
    let failNext = true
    store.schedule.delete = async (pk, rk) => {
      if (pk === '202611051001' && failNext) {
        failNext = false
        throw new Error('storage unavailable')
      }
      return originalDelete(pk, rk)
    }

    clock.set('2026-11-05T10:02:00.000Z')
    const first = run(ctx)
    expect(await first.result).toMatchObject({ errors: 1, delivered: 2, cursor: '202611051000' })
    expect(await cursorOf(store)).toBe('202611051000')

    clock.set('2026-11-05T10:03:00.000Z')
    const second = run(ctx)
    expect(await second.result).toMatchObject({ errors: 0, cursor: '202611051003' })
    // The failed row is retried (at-least-once); the completed one is not resent.
    expect(second.push.calls.map((c) => (c.payload as ReminderPushPayload).taskId)).toEqual(['a'])
    expect(store.schedule.all()).toEqual([])
  })

  it('does nothing when the cursor is ahead of the clock', async () => {
    const ctx = await createTestContext('2026-11-05T10:00:00.000Z')
    await setCursor(ctx.store, '202611051010')
    const { push, result } = run(ctx)
    await result
    expect(push.calls).toEqual([])
    expect(await cursorOf(ctx.store)).toBe('202611051010')
  })
})
