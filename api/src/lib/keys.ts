// Table Storage key helpers. PartitionKey/RowKey must not contain `/ \ # ?` or control
// characters, so opaque ids are base64url-encoded and endpoints are hashed.
import { createHash } from 'node:crypto'

const MINUTE_MS = 60_000
const BUCKET_RE = /^\d{12}$/

/** base64url of the UTF-8 bytes: safe for keys and reversible. */
export function encodeId(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url')
}

export function endpointKey(endpoint: string): string {
  return createHash('sha256').update(endpoint, 'utf8').digest('hex')
}

export function scheduleRowKey(userKey: string, encodedTaskId: string): string {
  return `${userKey}|${encodedTaskId}`
}

/** Minute bucket `yyyyMMddHHmm` (UTC); lexicographic order equals chronological order. */
export function bucketOf(time: Date | number): string {
  const d = new Date(typeof time === 'number' ? time : time.getTime())
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    String(d.getUTCFullYear()).padStart(4, '0') +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes())
  )
}

export function isBucket(value: unknown): value is string {
  return typeof value === 'string' && BUCKET_RE.test(value)
}

/** Start of the bucket in epoch milliseconds. */
export function bucketStartMs(bucket: string): number {
  return Date.UTC(
    Number(bucket.slice(0, 4)),
    Number(bucket.slice(4, 6)) - 1,
    Number(bucket.slice(6, 8)),
    Number(bucket.slice(8, 10)),
    Number(bucket.slice(10, 12)),
  )
}

export function addMinutes(bucket: string, minutes: number): string {
  return bucketOf(bucketStartMs(bucket) + minutes * MINUTE_MS)
}
