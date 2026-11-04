// Defensive parsing of request bodies. Shape errors are 400s; individual bad reminders are skipped.
import { isIP } from 'node:net'
import { badRequest, isRecord } from './http'

export const MAX_ENDPOINT_LENGTH = 2048
/** Graph ids are ~150 printable ASCII chars; this keeps encoded RowKeys far below the 1 KiB limit. */
export const MAX_ID_LENGTH = 256

const ID_RE = /^[\x21-\x7e]+$/
const BASE64URL_RE = /^[A-Za-z0-9+/_-]+={0,2}$/
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/

export interface SubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
}

export interface ReminderInput {
  taskId: string
  listId: string
  /** Normalised `toISOString()` form. */
  fireAt: string
  fireAtMs: number
}

function decodeKey(value: unknown, name: string, isValidLength: (bytes: number) => boolean): string {
  if (typeof value !== 'string' || value.length > 256 || !BASE64URL_RE.test(value)) {
    throw badRequest(`subscription.keys.${name} must be a base64url string.`)
  }
  if (!isValidLength(Buffer.from(value, 'base64url').length)) {
    throw badRequest(`subscription.keys.${name} has an invalid length.`)
  }
  return value
}

/** A push service URL: https on the default port, with a public DNS host name. */
export function isAcceptableEndpoint(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  const host = url.hostname.toLowerCase()
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    host.includes('.') &&
    !host.startsWith('[') &&
    isIP(host) === 0 &&
    host !== 'localhost' &&
    !host.endsWith('.localhost')
  )
}

export function parsePutSubscriptionRequest(body: unknown): SubscriptionInput {
  if (!isRecord(body) || !isRecord(body['subscription'])) {
    throw badRequest('Expected { subscription: { endpoint, keys: { p256dh, auth } } }.')
  }
  const subscription = body['subscription']
  const endpoint = subscription['endpoint']
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT_LENGTH || !isAcceptableEndpoint(endpoint)) {
    throw badRequest('subscription.endpoint must be an https push service URL.')
  }
  const keys = subscription['keys']
  if (!isRecord(keys)) throw badRequest('subscription.keys is required.')
  // Uncompressed P-256 point (65 bytes) and a 16-byte auth secret, as web-push requires.
  const p256dh = decodeKey(keys['p256dh'], 'p256dh', (n) => n === 65)
  const auth = decodeKey(keys['auth'], 'auth', (n) => n >= 16 && n <= 64)
  return { endpoint, p256dh, auth }
}

export function parseDeleteSubscriptionRequest(body: unknown): string {
  if (!isRecord(body)) throw badRequest('Expected { endpoint }.')
  const endpoint = body['endpoint']
  if (typeof endpoint !== 'string' || endpoint === '' || endpoint.length > MAX_ENDPOINT_LENGTH) {
    throw badRequest('endpoint must be a non-empty string.')
  }
  return endpoint
}

export function parsePutRemindersRequest(body: unknown): readonly unknown[] {
  if (!isRecord(body) || !Array.isArray(body['reminders'])) {
    throw badRequest('Expected { reminders: [...] }.')
  }
  return body['reminders']
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH && ID_RE.test(value)
}

/** Returns `undefined` for entries that are not a valid ReminderDto. */
export function parseReminder(value: unknown): ReminderInput | undefined {
  if (!isRecord(value)) return undefined
  const { taskId, listId, fireAt } = value
  if (!isId(taskId) || !isId(listId) || typeof fireAt !== 'string' || !ISO_INSTANT_RE.test(fireAt)) {
    return undefined
  }
  const fireAtMs = Date.parse(fireAt)
  if (!Number.isFinite(fireAtMs)) return undefined
  return { taskId, listId, fireAt: new Date(fireAtMs).toISOString(), fireAtMs }
}
