import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { handleGetGraphHook, handleGraphNotify } from '../src/handlers/sync'
import { createTestContext, HOOK_SECRET, KEY_A, makeRequest, PUBLIC_BASE_URL, TENANT_B, USER_B } from './helpers'

const LIST_1 = 'AQMkADAwATM3ZmYAZS04YjU0LTQ3NwA2LTAwAi0wMAoALgAAA_0jIcv-d5FOhpHwAiuEH88BABVi_bJlRFpBuHzG-aIVelgACWwt9HwAAAA='
const LIST_2 = 'AQMkADAwATM3ZmYAZS04YjU0LTQ3NwA2LTAwAi0wMAoALgAAA_second-list='

function clientStateFor(userKey: string): string {
  return createHmac('sha256', HOOK_SECRET).update(userKey, 'utf8').digest('base64url')
}

/** The shape Graph posted during the spike on 2026-11-06. */
function notification(listId: string, clientState: string, changeType = 'updated') {
  return {
    subscriptionId: 'd3b5c1e0-0000-4000-8000-000000000001',
    subscriptionExpirationDateTime: '2026-11-09T06:33:23.709+00:00',
    changeType,
    resource: `todob2/graph/v1/users('someone@example.com')/todoApp/lists('${listId}')/tasks`,
    resourceData: { '@odata.type': '#Microsoft.Graph.todoTask', id: 'task-id' },
    clientState,
    tenantId: '9188040d-6c67-4c5b-b112-36a304b66dad',
  }
}

function notifyRequest(userKey: string, items: unknown[]) {
  return makeRequest({ method: 'POST', url: `${PUBLIC_BASE_URL}/api/graph-notify?u=${userKey}`, body: { value: items } })
}

describe('GET /api/graph-hook', () => {
  it("returns the caller's notification URL and an HMAC clientState", async () => {
    const { deps, issuer } = await createTestContext()
    const response = await handleGetGraphHook(makeRequest({ method: 'GET', token: await issuer.token() }), deps)
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({
      notificationUrl: `${PUBLIC_BASE_URL}/api/graph-notify?u=${KEY_A}`,
      clientState: clientStateFor(KEY_A),
    })
  })

  it('gives each user a different clientState', async () => {
    const { deps, issuer } = await createTestContext()
    const other = await handleGetGraphHook(makeRequest({ method: 'GET', token: await issuer.token({ tid: TENANT_B, oid: USER_B }) }), deps)
    expect((other.jsonBody as { clientState: string }).clientState).not.toBe(clientStateFor(KEY_A))
  })

  it('requires a token', async () => {
    const { deps } = await createTestContext()
    expect((await handleGetGraphHook(makeRequest({ method: 'GET' }), deps)).status).toBe(401)
  })

  it('answers 503 when sync is not configured', async () => {
    const { deps, issuer } = await createTestContext()
    const response = await handleGetGraphHook(makeRequest({ method: 'GET', token: await issuer.token() }), { ...deps, sync: undefined })
    expect(response.status).toBe(503)
  })
})

describe('POST /api/graph-notify', () => {
  it("echoes Graph's validation token as text/plain", async () => {
    const { deps, realtime } = await createTestContext()
    const response = await handleGraphNotify(
      makeRequest({ method: 'POST', url: `${PUBLIC_BASE_URL}/api/graph-notify?u=${KEY_A}&validationToken=Validation%3A%20abc+123` }),
      deps,
    )
    expect(response).toEqual({ status: 200, body: 'Validation: abc 123', headers: { 'Content-Type': 'text/plain' } })
    expect(realtime.sent).toEqual([])
  })

  it('signals the user once with the changed lists, deduplicated', async () => {
    const { deps, realtime } = await createTestContext()
    const state = clientStateFor(KEY_A)
    const response = await handleGraphNotify(
      notifyRequest(KEY_A, [notification(LIST_1, state, 'created'), notification(LIST_1, state), notification(LIST_2, state, 'deleted')]),
      deps,
    )
    expect(response.status).toBe(202)
    expect(realtime.sent).toEqual([{ userKey: KEY_A, signal: { type: 'changed', listIds: [LIST_1, LIST_2] } }])
  })

  it('ignores notifications whose clientState does not match the user', async () => {
    const { deps, realtime } = await createTestContext()
    const response = await handleGraphNotify(notifyRequest(KEY_A, [notification(LIST_1, clientStateFor('someone_else'))]), deps)
    expect(response.status).toBe(202)
    expect(realtime.sent).toEqual([])
  })

  it('ignores a malformed user key', async () => {
    const { deps, realtime } = await createTestContext()
    const response = await handleGraphNotify(notifyRequest('not a key', [notification(LIST_1, clientStateFor('not a key'))]), deps)
    expect(response.status).toBe(202)
    expect(realtime.sent).toEqual([])
  })

  it('also reads list ids from /me/todo/lists/{id}/tasks resources', async () => {
    const { deps, realtime } = await createTestContext()
    const item = { ...notification(LIST_1, clientStateFor(KEY_A)), resource: `/me/todo/lists/${encodeURIComponent(LIST_2)}/tasks` }
    await handleGraphNotify(notifyRequest(KEY_A, [item]), deps)
    expect(realtime.sent[0]?.signal.listIds).toEqual([LIST_2])
  })

  it('rejects a body that is not a notification collection', async () => {
    const { deps } = await createTestContext()
    const response = await handleGraphNotify(
      makeRequest({ method: 'POST', url: `${PUBLIC_BASE_URL}/api/graph-notify?u=${KEY_A}`, body: { nope: true } }),
      deps,
    )
    expect(response.status).toBe(400)
  })
})
