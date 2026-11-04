// Full reconcile of a user's pending reminders to exactly the set the client sends.
import { LIMITS, type PutRemindersResponse } from '@woutist/contracts'
import { forEachLimit } from '../lib/concurrency'
import { bucketOf, encodeId, scheduleRowKey } from '../lib/keys'
import type { ReminderEntity, Store } from '../lib/tables'
import { parseReminder, type ReminderInput } from '../lib/validation'

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS
const WRITE_CONCURRENCY = 16

/**
 * Bucket a reminder is scheduled in. Reminders due in the current minute (or the 1-minute grace
 * period) go to the next bucket, which the timer has certainly not processed yet.
 */
export function scheduleBucket(fireAtMs: number, nowMs: number): string {
  const fireBucket = bucketOf(fireAtMs)
  const earliest = bucketOf(nowMs + MINUTE_MS)
  return fireBucket > earliest ? fireBucket : earliest
}

/** Valid entries within (now - 1 min, now + horizon], one per taskId (earliest fireAt), capped. */
export function selectDesired(entries: readonly unknown[], now: Date): ReminderInput[] {
  const nowMs = now.getTime()
  const minMs = nowMs - MINUTE_MS
  const maxMs = nowMs + LIMITS.reminderHorizonDays * DAY_MS
  const byTask = new Map<string, ReminderInput>()
  for (const entry of entries) {
    const reminder = parseReminder(entry)
    if (!reminder || reminder.fireAtMs <= minMs || reminder.fireAtMs > maxMs) continue
    const seen = byTask.get(reminder.taskId)
    if (!seen || reminder.fireAtMs < seen.fireAtMs) byTask.set(reminder.taskId, reminder)
  }
  return [...byTask.values()]
    .sort((a, b) => a.fireAtMs - b.fireAtMs || (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0))
    .slice(0, LIMITS.maxRemindersPerUser)
}

export async function reconcileReminders(
  store: Store,
  userKey: string,
  entries: readonly unknown[],
  now: Date,
): Promise<PutRemindersResponse> {
  const desired = selectDesired(entries, now)
  const desiredByRowKey = new Map(desired.map((r) => [encodeId(r.taskId), r]))
  const existing = await store.reminders.listPartition(userKey)
  const existingByRowKey = new Map(existing.map((r) => [r.rowKey, r]))

  const stale = existing.filter((r) => !desiredByRowKey.has(r.rowKey))
  await forEachLimit(stale, WRITE_CONCURRENCY, async (row) => {
    // Reminder row first: the timer ignores schedule rows without a matching reminder.
    await store.reminders.delete(userKey, row.rowKey)
    await store.schedule.delete(row.bucket, scheduleRowKey(userKey, row.rowKey))
  })

  const nowMs = now.getTime()
  const writes = [...desiredByRowKey].filter(([rowKey, r]) => {
    const current = existingByRowKey.get(rowKey)
    return !current || current.fireAt !== r.fireAt || current.listId !== r.listId || current.taskId !== r.taskId
  })
  await forEachLimit(writes, WRITE_CONCURRENCY, async ([rowKey, r]) => {
    const current = existingByRowKey.get(rowKey)
    // An unchanged fire time keeps its bucket (e.g. a task moved to another list).
    const bucket = current && current.fireAt === r.fireAt ? current.bucket : scheduleBucket(r.fireAtMs, nowMs)
    const scheduleKey = scheduleRowKey(userKey, rowKey)
    // Schedule row before reminder row, so a partial failure never leaves an unscheduled reminder.
    await store.schedule.upsert({
      partitionKey: bucket,
      rowKey: scheduleKey,
      userKey,
      taskId: r.taskId,
      listId: r.listId,
      fireAt: r.fireAt,
    })
    const reminder: ReminderEntity = {
      partitionKey: userKey,
      rowKey,
      taskId: r.taskId,
      listId: r.listId,
      fireAt: r.fireAt,
      bucket,
    }
    await store.reminders.upsert(reminder)
    if (current && current.bucket !== bucket) {
      await store.schedule.delete(current.bucket, scheduleKey)
    }
  })

  return { scheduled: desired.length, removed: stale.length, skipped: entries.length - desired.length }
}

/** Removes every reminder (and schedule row) of the user. */
export async function deleteAllReminders(store: Store, userKey: string): Promise<number> {
  const rows = await store.reminders.listPartition(userKey)
  await forEachLimit(rows, WRITE_CONCURRENCY, async (row) => {
    await store.reminders.delete(userKey, row.rowKey)
    await store.schedule.delete(row.bucket, scheduleRowKey(userKey, row.rowKey))
  })
  return rows.length
}
