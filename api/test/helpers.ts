import { createECDH, randomBytes } from 'node:crypto'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose'
import { API_SCOPE_NAME } from '@woutist/contracts'
import { createAuthenticator, type AuthOptions, type Authenticator } from '../src/lib/auth'
import type { HandlerDeps } from '../src/handlers/api'
import type { ApiRequest } from '../src/lib/http'
import type { Logger } from '../src/lib/logger'
import { createMemoryStore, type MemoryStore } from '../src/lib/memoryStore'
import type { PushOutcome, PushSender } from '../src/lib/push'
import type { FcmSender } from '../src/lib/fcm'
import type { RealtimeChannel } from '../src/lib/realtime'
import type { SyncSignal } from '@woutist/contracts'
import type { SubscriptionInput } from '../src/lib/validation'

export const CLIENT_ID = '0f1e2d3c-4b5a-4968-8776-655443322110'
export const TENANT_A = 'aaaaaaaa-1111-4111-8111-111111111111'
export const TENANT_B = 'bbbbbbbb-2222-4222-8222-222222222222'
export const USER_A = '0000000a-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const USER_B = '0000000b-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
export const KEY_A = `${TENANT_A}_${USER_A}`
export const KEY_B = `${TENANT_B}_${USER_B}`

export interface TokenClaims {
  tid?: string
  oid?: string
  aud?: string
  iss?: string
  scp?: string | undefined
  /** Seconds since epoch, or a jose time span such as '1h' / '-10m' (relative to now). */
  exp?: number | string
  extra?: JWTPayload
}

export interface TestIssuer {
  jwks: NonNullable<AuthOptions['jwks']>
  token(claims?: TokenClaims): Promise<string>
  authenticator(options?: Partial<AuthOptions>): Authenticator
}

export async function createTestIssuer(): Promise<TestIssuer> {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = await exportJWK(publicKey)
  const jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] })

  const token = async (claims: TokenClaims = {}): Promise<string> => {
    const tid = claims.tid ?? TENANT_A
    const payload: JWTPayload = { tid, oid: claims.oid ?? USER_A, ver: '2.0', ...claims.extra }
    if (!('scp' in claims)) payload['scp'] = `openid ${API_SCOPE_NAME}`
    else if (claims.scp !== undefined) payload['scp'] = claims.scp
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })
      .setIssuer(claims.iss ?? `https://login.microsoftonline.com/${tid}/v2.0`)
      .setAudience(claims.aud ?? CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime(claims.exp ?? '1h')
      .sign(privateKey)
  }

  return {
    jwks,
    token,
    authenticator: (options = {}) => createAuthenticator({ clientId: CLIENT_ID, jwks, ...options }),
  }
}

export interface RequestOptions {
  url?: string
  token?: string | undefined
  body?: unknown
  rawBody?: string
  headers?: Record<string, string>
  method?: string
}

export function makeRequest(options: RequestOptions = {}): ApiRequest {
  const headers = new Map<string, string>()
  for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name.toLowerCase(), value)
  if (options.token) headers.set('authorization', `Bearer ${options.token}`)
  const text = options.rawBody ?? (options.body === undefined ? '' : JSON.stringify(options.body))
  return {
    method: options.method ?? 'PUT',
    url: options.url ?? 'https://api.test/api/x',
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    text: async () => text,
  }
}

export interface RecordingLogger extends Logger {
  messages: { level: string; message: string }[]
}

export function recordingLogger(): RecordingLogger {
  const messages: { level: string; message: string }[] = []
  return {
    messages,
    info: (message) => messages.push({ level: 'info', message }),
    warn: (message) => messages.push({ level: 'warn', message }),
    error: (message) => messages.push({ level: 'error', message }),
  }
}

export class TestClock {
  #ms: number
  constructor(iso: string) {
    this.#ms = Date.parse(iso)
  }
  now = (): Date => new Date(this.#ms)
  set(iso: string): void {
    this.#ms = Date.parse(iso)
  }
  advance(ms: number): void {
    this.#ms += ms
  }
  plus(ms: number): string {
    return new Date(this.#ms + ms).toISOString()
  }
}

export const HOOK_SECRET = 'test-hook-secret-0123456789abcdef'
export const PUBLIC_BASE_URL = 'https://api.test'

export interface TestContext {
  store: MemoryStore
  issuer: TestIssuer
  clock: TestClock
  log: RecordingLogger
  realtime: FakeRealtime
  fcm: FakeFcm
  deps: HandlerDeps
}

export async function createTestContext(nowIso = '2026-11-05T10:00:00.000Z'): Promise<TestContext> {
  const store = createMemoryStore()
  const issuer = await createTestIssuer()
  const clock = new TestClock(nowIso)
  const log = recordingLogger()
  const realtime = fakeRealtime()
  const fcm = fakeFcm()
  return {
    store,
    issuer,
    clock,
    log,
    realtime,
    fcm,
    deps: {
      authenticate: issuer.authenticator(),
      store,
      now: clock.now,
      log,
      sync: { hookSecret: HOOK_SECRET, publicBaseUrl: PUBLIC_BASE_URL, realtime, fcm: fcm.send },
    },
  }
}

export interface FakeRealtime extends RealtimeChannel {
  sent: { userKey: string; signal: SyncSignal }[]
}

export function fakeRealtime(): FakeRealtime {
  const sent: { userKey: string; signal: SyncSignal }[] = []
  return {
    sent,
    send: async (userKey, signal) => {
      sent.push({ userKey, signal })
    },
    clientUrl: async (userKey) => `wss://pubsub.test/client/hubs/sync?user=${userKey}`,
  }
}

export interface FakeFcm {
  send: FcmSender
  calls: { token: string; signal: SyncSignal }[]
  responses: Map<string, PushOutcome>
}

export function fakeFcm(): FakeFcm {
  const calls: { token: string; signal: SyncSignal }[] = []
  const responses = new Map<string, PushOutcome>()
  return {
    calls,
    responses,
    send: async (token, signal) => {
      calls.push({ token, signal })
      return responses.get(token) ?? { ok: true, statusCode: 200 }
    },
  }
}

export function makeSubscription(endpoint = `https://fcm.googleapis.com/fcm/send/${randomBytes(8).toString('hex')}`): SubscriptionInput {
  const ecdh = createECDH('prime256v1')
  return {
    endpoint,
    p256dh: ecdh.generateKeys().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  }
}

export function subscriptionBody(sub: SubscriptionInput): unknown {
  return { subscription: { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.p256dh, auth: sub.auth } } }
}

export interface FakePush {
  send: PushSender
  calls: { endpoint: string; payload: unknown }[]
  responses: Map<string, PushOutcome>
}

export function fakePush(): FakePush {
  const calls: { endpoint: string; payload: unknown }[] = []
  const responses = new Map<string, PushOutcome>()
  return {
    calls,
    responses,
    send: async (target, payload) => {
      calls.push({ endpoint: target.endpoint, payload: JSON.parse(payload) as unknown })
      return responses.get(target.endpoint) ?? { ok: true, statusCode: 201 }
    },
  }
}
