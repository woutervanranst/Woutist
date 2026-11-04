// Web Push (VAPID) sender. Injectable so the timer can be tested without network access.
import { sendNotification, setVapidDetails } from 'web-push'

export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushOutcome {
  ok: boolean
  /** HTTP status from the push service, when one was received. */
  statusCode?: number
  message?: string
}

export type PushSender = (target: PushTarget, payload: string) => Promise<PushOutcome>

export interface VapidSettings {
  /** `mailto:` or `https:` contact URI (web-push rejects anything else). */
  subject: string
  publicKey: string
  privateKey: string
}

/** Reminders older than this are useless, so the push service may drop them. */
export const PUSH_TTL_SECONDS = 60 * 60

export function createWebPushSender(vapid: VapidSettings): PushSender {
  setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)
  return async (target, payload) => {
    try {
      const result = await sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
        { TTL: PUSH_TTL_SECONDS, urgency: 'high', timeout: 15_000 },
      )
      return { ok: true, statusCode: result.statusCode }
    } catch (err) {
      const statusCode = (err as { statusCode?: unknown } | null)?.statusCode
      return {
        ok: false,
        ...(typeof statusCode === 'number' ? { statusCode } : {}),
        message: err instanceof Error ? err.message : String(err),
      }
    }
  }
}
