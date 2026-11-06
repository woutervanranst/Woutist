import { describe, expect, it } from 'vitest'
import { handleGetRealtime } from '../src/handlers/sync'
import { createTestContext, KEY_A, makeRequest } from './helpers'

describe('GET /api/realtime', () => {
  it('returns a client URL bound to the caller', async () => {
    const { deps, issuer } = await createTestContext()
    const response = await handleGetRealtime(makeRequest({ method: 'GET', token: await issuer.token() }), deps)
    expect(response).toEqual({ status: 200, jsonBody: { url: `wss://pubsub.test/client/hubs/sync?user=${KEY_A}` } })
  })

  it('requires a token', async () => {
    const { deps } = await createTestContext()
    expect((await handleGetRealtime(makeRequest({ method: 'GET' }), deps)).status).toBe(401)
  })

  it('answers 503 without a realtime channel', async () => {
    const { deps, issuer } = await createTestContext()
    const sync = { ...deps.sync!, realtime: undefined }
    const response = await handleGetRealtime(makeRequest({ method: 'GET', token: await issuer.token() }), { ...deps, sync })
    expect(response.status).toBe(503)
  })
})
