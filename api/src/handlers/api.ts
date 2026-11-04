// Request → response logic for the HTTP functions, independent of the Functions host.
import type { PutRemindersResponse } from '@woutist/contracts'
import { requireUser, type Authenticator } from '../lib/auth'
import { handleErrors, noContent, okJson, readJsonBody, type ApiRequest, type ApiResponse } from '../lib/http'
import type { Logger } from '../lib/logger'
import type { Store } from '../lib/tables'
import {
  parseDeleteSubscriptionRequest,
  parsePutRemindersRequest,
  parsePutSubscriptionRequest,
} from '../lib/validation'
import { deleteUserData } from '../services/account'
import { reconcileReminders } from '../services/reminders'
import { deleteSubscription, upsertSubscription } from '../services/subscriptions'

export interface HandlerDeps {
  authenticate: Authenticator
  store: Store
  now: () => Date
  log: Logger
}

/** PUT /api/subscription */
export function handlePutSubscription(req: ApiRequest, deps: HandlerDeps): Promise<ApiResponse> {
  return handleErrors(deps.log, async () => {
    const user = await requireUser(req, deps.authenticate)
    const input = parsePutSubscriptionRequest(await readJsonBody(req))
    const { evicted } = await upsertSubscription(deps.store, user.userKey, input, deps.now())
    if (evicted > 0) deps.log.info(`Evicted ${evicted} old push subscription(s).`)
    return noContent()
  })
}

/** DELETE /api/subscription */
export function handleDeleteSubscription(req: ApiRequest, deps: HandlerDeps): Promise<ApiResponse> {
  return handleErrors(deps.log, async () => {
    const user = await requireUser(req, deps.authenticate)
    const endpoint = parseDeleteSubscriptionRequest(await readJsonBody(req))
    await deleteSubscription(deps.store, user.userKey, endpoint)
    return noContent()
  })
}

/** PUT /api/reminders */
export function handlePutReminders(req: ApiRequest, deps: HandlerDeps): Promise<ApiResponse> {
  return handleErrors(deps.log, async () => {
    const user = await requireUser(req, deps.authenticate)
    const entries = parsePutRemindersRequest(await readJsonBody(req))
    const response: PutRemindersResponse = await reconcileReminders(deps.store, user.userKey, entries, deps.now())
    return okJson(response)
  })
}

/** DELETE /api/me */
export function handleDeleteMe(req: ApiRequest, deps: HandlerDeps): Promise<ApiResponse> {
  return handleErrors(deps.log, async () => {
    const user = await requireUser(req, deps.authenticate)
    await deleteUserData(deps.store, user.userKey)
    return noContent()
  })
}
