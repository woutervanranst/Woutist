// Production wiring: builds dependencies from app settings once per worker process.
import { DefaultAzureCredential } from '@azure/identity'
import type { HandlerDeps, SyncConfig } from '../handlers/api'
import { createAuthenticator, type Authenticator } from './auth'
import { createFcmSender, parseServiceAccount } from './fcm'
import { errorResponse, type ApiResponse } from './http'
import { contextLogger, type Logger } from './logger'
import { createWebPushSender, type PushSender } from './push'
import { createWebPubSubChannel } from './realtime'
import { createAzureStore, type Store } from './tables'

type Env = Record<string, string | undefined>

let authenticator: Authenticator | undefined
let store: Store | undefined
let pushSender: PushSender | undefined
/** `null`: sync signals are not configured. */
let syncConfig: SyncConfig | null | undefined

/** Long enough that the per-user clientState can't be guessed. */
const MIN_HOOK_SECRET_LENGTH = 32

/**
 * Sync signals need `GRAPH_HOOK_SECRET` and `PUBLIC_API_BASE_URL`. Web PubSub (`WEBPUBSUB_ENDPOINT` or
 * `WEBPUBSUB_CONNECTION_STRING`, optional `WEBPUBSUB_HUB`) and FCM (`FCM_SERVICE_ACCOUNT`, the key file's
 * JSON) are each optional. Throws when a setting is present but invalid.
 */
export function getSyncConfig(env: Env = process.env): SyncConfig | undefined {
  if (syncConfig === undefined) {
    const hookSecret = env['GRAPH_HOOK_SECRET']?.trim()
    const publicBaseUrl = env['PUBLIC_API_BASE_URL']?.trim()
    if (!hookSecret || !publicBaseUrl) {
      syncConfig = null
    } else {
      if (hookSecret.length < MIN_HOOK_SECRET_LENGTH) {
        throw new Error(`GRAPH_HOOK_SECRET must be at least ${MIN_HOOK_SECRET_LENGTH} characters.`)
      }
      if (new URL(publicBaseUrl).protocol !== 'https:') throw new Error('PUBLIC_API_BASE_URL must be an https URL.')
      const hub = env['WEBPUBSUB_HUB']?.trim() || 'sync'
      const connectionString = env['WEBPUBSUB_CONNECTION_STRING']?.trim()
      const endpoint = env['WEBPUBSUB_ENDPOINT']?.trim()
      const fcmAccount = env['FCM_SERVICE_ACCOUNT']?.trim()
      syncConfig = {
        hookSecret,
        publicBaseUrl,
        realtime: connectionString
          ? createWebPubSubChannel({ connectionString, hub })
          : endpoint
            ? createWebPubSubChannel({ endpoint, hub, credential: new DefaultAzureCredential() })
            : undefined,
        fcm: fcmAccount ? createFcmSender(parseServiceAccount(fcmAccount)) : undefined,
      }
    }
  }
  return syncConfig ?? undefined
}

export function getStore(env: Env = process.env): Store {
  store ??= createAzureStore({
    connectionString: env['TABLES_CONNECTION_STRING'],
    endpoint: env['TABLES_ENDPOINT'],
  })
  return store
}

function getAuthenticator(env: Env = process.env): Authenticator {
  authenticator ??= createAuthenticator({
    clientId: env['ENTRA_CLIENT_ID'] ?? '',
    allowedUsers: env['ALLOWED_USERS'],
  })
  return authenticator
}

/** Throws when VAPID settings are missing or invalid. */
export function getPushSender(env: Env = process.env): PushSender {
  if (!pushSender) {
    const subject = env['VAPID_SUBJECT']?.trim()
    const publicKey = env['VAPID_PUBLIC_KEY']?.trim()
    const privateKey = env['VAPID_PRIVATE_KEY']?.trim()
    if (!subject || !publicKey || !privateKey) {
      throw new Error('VAPID_SUBJECT, VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured.')
    }
    pushSender = createWebPushSender({ subject, publicKey, privateKey })
  }
  return pushSender
}

type Context = Parameters<typeof contextLogger>[0]

/** Builds the handler dependencies, answering 500 if the app is misconfigured. */
export async function runHttp(
  context: Context,
  handler: (deps: HandlerDeps) => Promise<ApiResponse>,
): Promise<ApiResponse> {
  const log: Logger = contextLogger(context)
  let deps: HandlerDeps
  try {
    deps = { authenticate: getAuthenticator(), store: getStore(), now: () => new Date(), log }
  } catch (err) {
    log.error('The API is misconfigured', err)
    return errorResponse(500, 'server_misconfigured', 'The service is not configured correctly.')
  }
  try {
    deps.sync = getSyncConfig()
  } catch (err) {
    // Reminders keep working; the sync endpoints answer 503 until the settings are fixed.
    log.error('Sync signals are misconfigured', err)
  }
  return handler(deps)
}
