// Near-instant sync: Graph change notifications in, "sync these lists" signals out to the user's devices.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { GraphHookResponse, RealtimeResponse } from '@woutist/contracts'
import { requireUser } from '../lib/auth'
import {
  accepted,
  handleErrors,
  HttpError,
  noContent,
  okJson,
  readJsonBody,
  type ApiRequest,
  type ApiResponse,
} from '../lib/http'
import { isUserKey, listIdOfResource, parseDeviceRequest, parseNotificationCollection } from '../lib/validation'
import { deleteDevice, upsertDevice } from '../services/devices'
import { signalUser } from '../services/syncSignals'
import type { HandlerDeps, SyncConfig } from './api'

function requireSync(deps: HandlerDeps): SyncConfig {
  if (!deps.sync) throw new HttpError(503, 'not_configured', 'Sync signals are not configured on this server.')
  return deps.sync
}

function clientStateFor(secret: string, userKey: string): string {
  return createHmac('sha256', secret).update(userKey, 'utf8').digest('base64url')
}

/**
 * A short fingerprint of the secret in the notification URL: rotating the secret changes the URL, so
 * devices treat old subscriptions (with the old clientState) as someone else's, let them expire and
 * create new ones. The handler itself ignores it.
 */
function secretVersion(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('base64url').slice(0, 8)
}

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

/** GET /api/graph-hook */
export function handleGetGraphHook(req: ApiRequest, deps: HandlerDeps): Promise<ApiResponse> {
  return handleErrors(deps.log, async () => {
    const user = await requireUser(req, deps.authenticate)
    const sync = requireSync(deps)
    const base = sync.publicBaseUrl.replace(/\/+$/, '')
    const response: GraphHookResponse = {
      // Path only: Graph appends its own query (?validationToken=) to this URL.
      notificationUrl: `${base}/api/graph-notify/${encodeURIComponent(user.userKey)}/${secretVersion(sync.hookSecret)}`,
      clientState: clientStateFor(sync.hookSecret, user.userKey),
    }
    return okJson(response)
  })
}

/**
 * POST /api/graph-notify/<userKey>/<secret version> (anonymous: Graph calls it).
 * Answers Graph's validation request, then signals the user for every list whose notification carries
 * the user's clientState. Anything else is dropped with 202, so callers learn nothing.
 */
export function handleGraphNotify(req: ApiRequest, deps: HandlerDeps): Promise<ApiResponse> {
  return handleErrors(deps.log, async () => {
    const sync = requireSync(deps)
    const url = new URL(req.url ?? '', 'http://localhost')
    const validationToken = url.searchParams.get('validationToken')
    if (validationToken !== null) {
      return { status: 200, body: validationToken, headers: { 'Content-Type': 'text/plain' } }
    }

    const items = parseNotificationCollection(await readJsonBody(req))
    const userKey = /\/graph-notify\/([^/]+)/.exec(url.pathname)?.[1]
    if (!isUserKey(userKey)) return accepted()
    const expected = clientStateFor(sync.hookSecret, userKey)
    const listIds = new Set<string>()
    for (const item of items) {
      if (typeof item.clientState !== 'string' || !sameString(item.clientState, expected)) continue
      const listId = listIdOfResource(item.resource)
      if (listId) listIds.add(listId)
    }
    if (listIds.size > 0) await signalUser(deps, userKey, { type: 'changed', listIds: [...listIds] })
    return accepted()
  })
}

/** GET /api/realtime */
export function handleGetRealtime(req: ApiRequest, deps: HandlerDeps): Promise<ApiResponse> {
  return handleErrors(deps.log, async () => {
    const user = await requireUser(req, deps.authenticate)
    const realtime = requireSync(deps).realtime
    if (!realtime) throw new HttpError(503, 'not_configured', 'The realtime channel is not configured on this server.')
    const response: RealtimeResponse = { url: await realtime.clientUrl(user.userKey) }
    return okJson(response)
  })
}

/** PUT /api/devices */
export function handlePutDevice(req: ApiRequest, deps: HandlerDeps): Promise<ApiResponse> {
  return handleErrors(deps.log, async () => {
    const user = await requireUser(req, deps.authenticate)
    const token = parseDeviceRequest(await readJsonBody(req))
    await upsertDevice(deps.store, user.userKey, token, deps.now())
    return noContent()
  })
}

/** DELETE /api/devices */
export function handleDeleteDevice(req: ApiRequest, deps: HandlerDeps): Promise<ApiResponse> {
  return handleErrors(deps.log, async () => {
    const user = await requireUser(req, deps.authenticate)
    const token = parseDeviceRequest(await readJsonBody(req))
    await deleteDevice(deps.store, user.userKey, token)
    return noContent()
  })
}
