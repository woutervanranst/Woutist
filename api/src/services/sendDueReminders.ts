// Timer logic: sends Web Push messages for every schedule row whose minute bucket is due.
import { LIMITS, type ReminderPushPayload } from '@woutist/contracts'
import { forEachLimit } from '../lib/concurrency'
import { addMinutes, bucketOf, isBucket } from '../lib/keys'
import type { Logger } from '../lib/logger'
import type { PushOutcome, PushSender } from '../lib/push'
import type { ScheduleEntity, Store, SubscriptionEntity } from '../lib/tables'

export const CURSOR_PARTITION = 'timer'
export const CURSOR_ROW = 'cursor'

const HOUR_MS = 60 * 60_000
const ROW_CONCURRENCY = 8

export interface SendDueRemindersDeps {
  store: Store
  now: () => Date
  send: PushSender
  log: Logger
}

export interface SendDueRemindersResult {
  /** First bucket queried (the previous cursor, swept again for late writes). */
  fromBucket: string
  toBucket: string
  /** Cursor after the run. */
  cursor: string
  /** Schedule rows for which notifications were sent. */
  delivered: number
  /** Individual push messages accepted by a push service. */
  notifications: number
  /** Push messages that failed with something other than 404/410. */
  pushFailures: number
  /** Subscriptions deleted because the push service answered 404/410. */
  subscriptionsRemoved: number
  /** Rows older than the catch-up window: dropped without sending. */
  expired: number
  /** Rows without a matching reminder (changed or deleted meanwhile): dropped without sending. */
  stale: number
  /** Rows that hit a storage error; they stay and are retried by the next run. */
  errors: number
}

/**
 * Processes buckets from the stored cursor up to the current minute bucket (inclusive), never sending
 * anything older than {@link LIMITS.catchUpHours}. The cursor advances after each bucket, but not past
 * a bucket in which a row failed, so that row is retried on the next run.
 */
export async function sendDueReminders(deps: SendDueRemindersDeps): Promise<SendDueRemindersResult> {
  const { store, send, log } = deps
  const nowMs = deps.now().getTime()
  const current = bucketOf(nowMs)
  const oldestSendable = bucketOf(nowMs - LIMITS.catchUpHours * HOUR_MS)
  const state = await store.state.get(CURSOR_PARTITION, CURSOR_ROW)
  const cursor = isBucket(state?.lastProcessedBucket) ? state.lastProcessedBucket : addMinutes(current, -1)

  const result: SendDueRemindersResult = {
    fromBucket: cursor,
    toBucket: current,
    cursor,
    delivered: 0,
    notifications: 0,
    pushFailures: 0,
    subscriptionsRemoved: 0,
    expired: 0,
    stale: 0,
    errors: 0,
  }
  if (cursor > current) {
    log.warn(`Timer cursor ${cursor} is ahead of the clock (${current}); nothing to do.`)
    return result
  }

  const subscriptionCache = new Map<string, Promise<SubscriptionEntity[]>>()
  const goneSubscriptions = new Set<string>()

  const subscriptionsOf = (userKey: string): Promise<SubscriptionEntity[]> => {
    let cached = subscriptionCache.get(userKey)
    if (!cached) {
      cached = store.subscriptions.listPartition(userKey)
      cached.catch(() => subscriptionCache.delete(userKey))
      subscriptionCache.set(userKey, cached)
    }
    return cached
  }

  const deliver = async (row: ScheduleEntity): Promise<void> => {
    const payload: ReminderPushPayload = { type: 'reminder', taskId: row.taskId, listId: row.listId, fireAt: row.fireAt }
    const body = JSON.stringify(payload)
    const subscriptions = await subscriptionsOf(row.userKey)
    await Promise.all(
      subscriptions.map(async (sub) => {
        const id = `${sub.partitionKey}/${sub.rowKey}`
        if (goneSubscriptions.has(id)) return
        let outcome: PushOutcome
        try {
          outcome = await send({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, body)
        } catch (err) {
          outcome = { ok: false, message: err instanceof Error ? err.message : String(err) }
        }
        if (outcome.ok) {
          result.notifications++
        } else if (outcome.statusCode === 404 || outcome.statusCode === 410) {
          goneSubscriptions.add(id)
          await store.subscriptions.delete(sub.partitionKey, sub.rowKey)
          result.subscriptionsRemoved++
        } else {
          result.pushFailures++
          log.warn(`Push to ${hostOf(sub.endpoint)} failed (${outcome.statusCode ?? 'no response'}): ${outcome.message ?? ''}`)
        }
      }),
    )
    result.delivered++
  }

  const processRow = async (row: ScheduleEntity, expired: boolean): Promise<void> => {
    const reminderRowKey = row.rowKey.slice(row.userKey.length + 1)
    const reminder = await store.reminders.get(row.userKey, reminderRowKey)
    const isCurrent = reminder !== undefined && reminder.fireAt === row.fireAt && reminder.bucket === row.partitionKey
    if (!isCurrent) result.stale++
    else if (expired) result.expired++
    else await deliver(row)
    await store.schedule.delete(row.partitionKey, row.rowKey)
    if (isCurrent) await store.reminders.delete(row.userKey, reminderRowKey)
  }

  const writeCursor = async (bucket: string): Promise<void> => {
    await store.state.upsert({ partitionKey: CURSOR_PARTITION, rowKey: CURSOR_ROW, lastProcessedBucket: bucket })
    result.cursor = bucket
  }

  // Re-reading the cursor bucket itself picks up rows that landed in it while it was being processed.
  const rows = await store.schedule.listPartitionRange(cursor, current)
  const buckets = new Map<string, ScheduleEntity[]>()
  for (const row of rows) {
    const list = buckets.get(row.partitionKey)
    if (list) list.push(row)
    else buckets.set(row.partitionKey, [row])
  }

  let blocked = false
  for (const bucket of [...buckets.keys()].sort()) {
    const bucketRows = buckets.get(bucket) ?? []
    const expired = bucket < oldestSendable
    const errorsBefore = result.errors
    await forEachLimit(bucketRows, ROW_CONCURRENCY, async (row) => {
      try {
        await processRow(row, expired)
      } catch (err) {
        result.errors++
        log.error(`Failed to process reminder in bucket ${bucket}`, err)
      }
    })
    if (result.errors > errorsBefore) blocked = true
    if (!blocked && bucket > result.cursor) await writeCursor(bucket)
  }
  if (!blocked && current > result.cursor) await writeCursor(current)
  return result
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch {
    return 'invalid endpoint'
  }
}
