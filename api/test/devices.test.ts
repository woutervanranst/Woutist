import { describe, expect, it } from 'vitest'
import { LIMITS } from '@woutist/contracts'
import { handleDeleteMe } from '../src/handlers/api'
import { handleDeleteDevice, handlePutDevice } from '../src/handlers/sync'
import { endpointKey } from '../src/lib/keys'
import { signalUser } from '../src/services/syncSignals'
import { createTestContext, KEY_A, KEY_B, makeRequest, TENANT_B, USER_B } from './helpers'

const TOKEN_1 = 'device-one'
const TOKEN_2 = 'device-two'

describe('PUT /api/devices', () => {
  it('stores an FCM token keyed by sha256(token)', async () => {
    const { deps, store, issuer, clock } = await createTestContext()
    const response = await handlePutDevice(makeRequest({ token: await issuer.token(), body: { token: TOKEN_1 } }), deps)
    expect(response.status).toBe(204)
    expect(store.devices.all()).toEqual([
      {
        partitionKey: KEY_A,
        rowKey: endpointKey(TOKEN_1),
        token: TOKEN_1,
        createdAt: clock.now().toISOString(),
        updatedAt: clock.now().toISOString(),
      },
    ])
  })

  it('refreshes updatedAt but keeps createdAt for a known token', async () => {
    const { deps, store, issuer, clock } = await createTestContext()
    const token = await issuer.token()
    await handlePutDevice(makeRequest({ token, body: { token: TOKEN_1 } }), deps)
    const created = clock.now().toISOString()
    clock.advance(60_000)
    await handlePutDevice(makeRequest({ token, body: { token: TOKEN_1 } }), deps)
    expect(store.devices.all()).toEqual([expect.objectContaining({ createdAt: created, updatedAt: clock.now().toISOString() })])
  })

  it(`keeps at most ${LIMITS.maxDevicesPerUser} per user, evicting the least recently updated`, async () => {
    const { deps, store, issuer, clock } = await createTestContext()
    const token = await issuer.token()
    for (let i = 0; i <= LIMITS.maxDevicesPerUser; i++) {
      await handlePutDevice(makeRequest({ token, body: { token: `device-${i}` } }), deps)
      clock.advance(1000)
    }
    const tokens = (await store.devices.listPartition(KEY_A)).map((d) => d.token)
    expect(tokens).toHaveLength(LIMITS.maxDevicesPerUser)
    expect(tokens).not.toContain('device-0')
  })

  it('rejects a missing or malformed token', async () => {
    const { deps, issuer } = await createTestContext()
    const auth = await issuer.token()
    for (const body of [{}, { token: '' }, { token: 'has spaces' }, { token: 'x'.repeat(5000) }, { token: 42 }]) {
      expect((await handlePutDevice(makeRequest({ token: auth, body }), deps)).status).toBe(400)
    }
  })

  it('requires a token', async () => {
    const { deps } = await createTestContext()
    expect((await handlePutDevice(makeRequest({ body: { token: TOKEN_1 } }), deps)).status).toBe(401)
  })
})

describe('DELETE /api/devices', () => {
  it("removes only the caller's token", async () => {
    const { deps, store, issuer } = await createTestContext()
    const tokenA = await issuer.token()
    const tokenB = await issuer.token({ tid: TENANT_B, oid: USER_B })
    await handlePutDevice(makeRequest({ token: tokenA, body: { token: TOKEN_1 } }), deps)
    await handlePutDevice(makeRequest({ token: tokenB, body: { token: TOKEN_1 } }), deps)
    const response = await handleDeleteDevice(makeRequest({ method: 'DELETE', token: tokenA, body: { token: TOKEN_1 } }), deps)
    expect(response.status).toBe(204)
    expect(store.devices.all().map((d) => d.partitionKey)).toEqual([KEY_B])
  })
})

describe('DELETE /api/me', () => {
  it("also deletes the caller's devices", async () => {
    const { deps, store, issuer } = await createTestContext()
    const token = await issuer.token()
    await handlePutDevice(makeRequest({ token, body: { token: TOKEN_1 } }), deps)
    await handleDeleteMe(makeRequest({ method: 'DELETE', token }), deps)
    expect(store.devices.all()).toEqual([])
  })
})

describe('signalUser', () => {
  it('sends the signal over the realtime channel and to every device', async () => {
    const { deps, issuer, realtime, fcm } = await createTestContext()
    const token = await issuer.token()
    await handlePutDevice(makeRequest({ token, body: { token: TOKEN_1 } }), deps)
    await handlePutDevice(makeRequest({ token, body: { token: TOKEN_2 } }), deps)
    const signal = { type: 'changed' as const, listIds: ['L1'] }
    await signalUser(deps, KEY_A, signal)
    expect(realtime.sent).toEqual([{ userKey: KEY_A, signal }])
    expect(fcm.calls.map((c) => c.token).sort()).toEqual([TOKEN_1, TOKEN_2])
  })

  it('removes a device that FCM reports as unregistered', async () => {
    const { deps, store, issuer, fcm } = await createTestContext()
    const token = await issuer.token()
    await handlePutDevice(makeRequest({ token, body: { token: TOKEN_1 } }), deps)
    await handlePutDevice(makeRequest({ token, body: { token: TOKEN_2 } }), deps)
    fcm.responses.set(TOKEN_1, { ok: false, statusCode: 404, message: 'UNREGISTERED' })
    fcm.responses.set(TOKEN_2, { ok: false, statusCode: 503, message: 'UNAVAILABLE' })
    await signalUser(deps, KEY_A, { type: 'changed', listIds: ['L1'] })
    expect(store.devices.all().map((d) => d.token)).toEqual([TOKEN_2])
  })

  it('still sends to devices when the realtime channel fails', async () => {
    const { deps, issuer, fcm, log } = await createTestContext()
    const token = await issuer.token()
    await handlePutDevice(makeRequest({ token, body: { token: TOKEN_1 } }), deps)
    const failing = { ...deps.sync!, realtime: { send: () => Promise.reject(new Error('down')), clientUrl: async () => '' } }
    await signalUser({ ...deps, sync: failing }, KEY_A, { type: 'changed', listIds: ['L1'] })
    expect(fcm.calls).toHaveLength(1)
    expect(log.messages.some((m) => m.level === 'warn')).toBe(true)
  })
})
