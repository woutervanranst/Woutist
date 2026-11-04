// Production wiring: builds dependencies from app settings once per worker process.
import type { HandlerDeps } from '../handlers/api'
import { createAuthenticator, type Authenticator } from './auth'
import { errorResponse, type ApiResponse } from './http'
import { contextLogger, type Logger } from './logger'
import { createWebPushSender, type PushSender } from './push'
import { createAzureStore, type Store } from './tables'

type Env = Record<string, string | undefined>

let authenticator: Authenticator | undefined
let store: Store | undefined
let pushSender: PushSender | undefined

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
  return handler(deps)
}
