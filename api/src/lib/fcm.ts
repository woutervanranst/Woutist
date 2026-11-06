// Firebase Cloud Messaging (HTTP v1) sender for sync signals to Android. Signs the service-account JWT
// with jose and exchanges it for an access token, so no Google SDK is needed. Injectable for tests.
import type { SyncSignal } from '@woutist/contracts'
import { importPKCS8, SignJWT } from 'jose'
import type { PushOutcome } from './push'

export type FcmSender = (token: string, signal: SyncSignal) => Promise<PushOutcome>

/** The fields of a Firebase service-account key file that FCM needs. */
export interface ServiceAccount {
  project_id: string
  client_email: string
  private_key: string
  token_uri: string
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
/** A signal older than this is pointless: the device syncs on start anyway. */
const TTL = '300s'
const TIMEOUT_MS = 10_000

export function parseServiceAccount(json: string): ServiceAccount {
  const raw = JSON.parse(json) as Record<string, unknown>
  const field = (name: keyof ServiceAccount): string => {
    const value = raw[name]
    if (typeof value !== 'string' || value === '') throw new Error(`The FCM service account has no ${name}.`)
    return value
  }
  return {
    project_id: field('project_id'),
    client_email: field('client_email'),
    private_key: field('private_key'),
    token_uri: field('token_uri'),
  }
}

export function createFcmSender(account: ServiceAccount, options: { fetch?: typeof fetch } = {}): FcmSender {
  const fetchFn = options.fetch ?? fetch
  const sendUrl = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`
  let cached: { token: string; expiresAt: number } | undefined

  const accessToken = async (): Promise<string> => {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
    const key = await importPKCS8(account.private_key, 'RS256')
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(account.client_email)
      .setAudience(account.token_uri)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key)
    const res = await fetchFn(account.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Google token endpoint answered ${res.status}`)
    const body = (await res.json()) as { access_token: string; expires_in: number }
    cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 }
    return cached.token
  }

  return async (token, signal) => {
    try {
      const res = await fetchFn(sendUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            data: { type: signal.type, listIds: JSON.stringify(signal.listIds) },
            android: { priority: 'high', collapse_key: 'sync', ttl: TTL },
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (res.ok) return { ok: true, statusCode: res.status }
      return { ok: false, statusCode: res.status, message: await res.text() }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }
}
