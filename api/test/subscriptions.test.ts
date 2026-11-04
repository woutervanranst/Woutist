import { describe, expect, it } from 'vitest'
import { LIMITS } from '@woutist/contracts'
import { handleDeleteSubscription, handlePutSubscription } from '../src/handlers/api'
import { MAX_BODY_BYTES } from '../src/lib/http'
import { endpointKey } from '../src/lib/keys'
import { createTestContext, KEY_A, KEY_B, makeRequest, makeSubscription, subscriptionBody, TENANT_B, USER_B } from './helpers'

describe('PUT /api/subscription', () => {
  it('stores a subscription keyed by sha256(endpoint)', async () => {
    const { deps, store, issuer, clock } = await createTestContext()
    const sub = makeSubscription()
    const response = await handlePutSubscription(makeRequest({ token: await issuer.token(), body: subscriptionBody(sub) }), deps)
    expect(response.status).toBe(204)
    expect(store.subscriptions.all()).toEqual([
      {
        partitionKey: KEY_A,
        rowKey: endpointKey(sub.endpoint),
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
        createdAt: clock.now().toISOString(),
        updatedAt: clock.now().toISOString(),
      },
    ])
    expect(endpointKey(sub.endpoint)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('upserts: same endpoint refreshes keys and updatedAt but keeps createdAt', async () => {
    const { deps, store, issuer, clock } = await createTestContext()
    const token = await issuer.token()
    const first = makeSubscription()
    await handlePutSubscription(makeRequest({ token, body: subscriptionBody(first) }), deps)
    const created = clock.now().toISOString()
    clock.advance(60_000)
    const refreshed = { ...makeSubscription(first.endpoint) }
    await handlePutSubscription(makeRequest({ token, body: subscriptionBody(refreshed) }), deps)
    const rows = store.subscriptions.all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ p256dh: refreshed.p256dh, auth: refreshed.auth, createdAt: created, updatedAt: clock.now().toISOString() })
  })

  it(`keeps at most ${LIMITS.maxSubscriptionsPerUser} per user, evicting the least recently updated`, async () => {
    const { deps, store, issuer, clock } = await createTestContext()
    const token = await issuer.token()
    const subs = Array.from({ length: LIMITS.maxSubscriptionsPerUser }, () => makeSubscription())
    for (const sub of subs) {
      await handlePutSubscription(makeRequest({ token, body: subscriptionBody(sub) }), deps)
      clock.advance(1000)
    }
    // Refresh the oldest one, so the second one becomes the least recently updated.
    await handlePutSubscription(makeRequest({ token, body: subscriptionBody(subs[0]!) }), deps)
    clock.advance(1000)
    // Another user's subscriptions do not count towards the cap.
    const otherToken = await issuer.token({ tid: TENANT_B, oid: USER_B })
    await handlePutSubscription(makeRequest({ token: otherToken, body: subscriptionBody(makeSubscription()) }), deps)

    const extra = makeSubscription()
    expect((await handlePutSubscription(makeRequest({ token, body: subscriptionBody(extra) }), deps)).status).toBe(204)

    const endpoints = (await store.subscriptions.listPartition(KEY_A)).map((s) => s.endpoint)
    expect(endpoints).toHaveLength(LIMITS.maxSubscriptionsPerUser)
    expect(endpoints).not.toContain(subs[1]!.endpoint)
    expect(endpoints).toContain(subs[0]!.endpoint)
    expect(endpoints).toContain(extra.endpoint)
    expect(await store.subscriptions.listPartition(KEY_B)).toHaveLength(1)
  })

  it('rejects malformed subscriptions with 400', async () => {
    const { deps, store, issuer } = await createTestContext()
    const token = await issuer.token()
    const good = makeSubscription()
    const bad: unknown[] = [
      {},
      { subscription: null },
      { subscription: { endpoint: 'http://fcm.googleapis.com/x', keys: { p256dh: good.p256dh, auth: good.auth } } },
      { subscription: { endpoint: 'https://10.0.0.1/x', keys: { p256dh: good.p256dh, auth: good.auth } } },
      { subscription: { endpoint: 'https://localhost/x', keys: { p256dh: good.p256dh, auth: good.auth } } },
      { subscription: { endpoint: 'https://push.example.com:8443/x', keys: { p256dh: good.p256dh, auth: good.auth } } },
      { subscription: { endpoint: 'not a url', keys: { p256dh: good.p256dh, auth: good.auth } } },
      { subscription: { endpoint: `https://fcm.googleapis.com/${'a'.repeat(3000)}`, keys: { p256dh: good.p256dh, auth: good.auth } } },
      { subscription: { endpoint: good.endpoint } },
      { subscription: { endpoint: good.endpoint, keys: { p256dh: 'short', auth: good.auth } } },
      { subscription: { endpoint: good.endpoint, keys: { p256dh: good.p256dh, auth: 'AAAA' } } },
      { subscription: { endpoint: good.endpoint, keys: { p256dh: good.p256dh, auth: 42 } } },
    ]
    for (const body of bad) {
      const response = await handlePutSubscription(makeRequest({ token, body }), deps)
      expect(response.status, JSON.stringify(body).slice(0, 120)).toBe(400)
      expect(response.jsonBody).toMatchObject({ error: 'bad_request' })
    }
    const invalidJson = await handlePutSubscription(makeRequest({ token, rawBody: '{"subscription":' }), deps)
    expect(invalidJson.status).toBe(400)
    expect(store.subscriptions.all()).toHaveLength(0)
  })

  it('rejects bodies larger than 512 KB with 413', async () => {
    const { deps, issuer } = await createTestContext()
    const token = await issuer.token()
    const big = makeRequest({ token, rawBody: JSON.stringify({ pad: 'x'.repeat(MAX_BODY_BYTES) }) })
    expect((await handlePutSubscription(big, deps)).status).toBe(413)
    const declared = makeRequest({ token, rawBody: '{}', headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) } })
    expect((await handlePutSubscription(declared, deps)).status).toBe(413)
  })

  it('requires authentication', async () => {
    const { deps, store } = await createTestContext()
    const response = await handlePutSubscription(makeRequest({ body: subscriptionBody(makeSubscription()) }), deps)
    expect(response.status).toBe(401)
    expect(store.subscriptions.all()).toHaveLength(0)
  })
})

describe('DELETE /api/subscription', () => {
  it('deletes only that subscription of the caller', async () => {
    const { deps, store, issuer } = await createTestContext()
    const token = await issuer.token()
    const keep = makeSubscription()
    const remove = makeSubscription()
    await handlePutSubscription(makeRequest({ token, body: subscriptionBody(keep) }), deps)
    await handlePutSubscription(makeRequest({ token, body: subscriptionBody(remove) }), deps)
    // Same endpoint registered by another user must survive.
    const otherToken = await issuer.token({ tid: TENANT_B, oid: USER_B })
    await handlePutSubscription(makeRequest({ token: otherToken, body: subscriptionBody(remove) }), deps)

    const response = await handleDeleteSubscription(
      makeRequest({ method: 'DELETE', token, body: { endpoint: remove.endpoint } }),
      deps,
    )
    expect(response.status).toBe(204)
    expect((await store.subscriptions.listPartition(KEY_A)).map((s) => s.endpoint)).toEqual([keep.endpoint])
    expect((await store.subscriptions.listPartition(KEY_B)).map((s) => s.endpoint)).toEqual([remove.endpoint])

    // Deleting an unknown endpoint is a no-op.
    const again = await handleDeleteSubscription(makeRequest({ method: 'DELETE', token, body: { endpoint: remove.endpoint } }), deps)
    expect(again.status).toBe(204)
  })

  it('rejects a body without endpoint', async () => {
    const { deps, issuer } = await createTestContext()
    const response = await handleDeleteSubscription(makeRequest({ method: 'DELETE', token: await issuer.token(), body: {} }), deps)
    expect(response.status).toBe(400)
  })
})
