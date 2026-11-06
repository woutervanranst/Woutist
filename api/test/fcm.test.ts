import { generateKeyPairSync } from 'node:crypto'
import { decodeJwt } from 'jose'
import { describe, expect, it } from 'vitest'
import { createFcmSender, parseServiceAccount } from '../src/lib/fcm'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const serviceAccount = {
  project_id: 'woutist-test',
  client_email: 'fcm@woutist-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  token_uri: 'https://oauth2.googleapis.com/token',
}

interface Call {
  url: string
  init: RequestInit
}

function fakeFetch(sendStatus = 200, sendBody: unknown = { name: 'projects/woutist-test/messages/1' }) {
  const calls: Call[] = []
  const fetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    if (String(url) === serviceAccount.token_uri) {
      return new Response(JSON.stringify({ access_token: 'google-access-token', expires_in: 3599 }), { status: 200 })
    }
    return new Response(JSON.stringify(sendBody), { status: sendStatus })
  }
  return { calls, fetch: fetch as typeof globalThis.fetch }
}

const signal = { type: 'changed' as const, listIds: ['L1', 'L2'] }

describe('createFcmSender', () => {
  it('exchanges a signed service-account JWT for an access token', async () => {
    const { calls, fetch } = fakeFetch()
    await createFcmSender(serviceAccount, { fetch })('device-token', signal)
    const tokenCall = calls[0]!
    expect(tokenCall.url).toBe(serviceAccount.token_uri)
    const form = new URLSearchParams(String(tokenCall.init.body))
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    expect(decodeJwt(form.get('assertion')!)).toMatchObject({
      iss: serviceAccount.client_email,
      aud: serviceAccount.token_uri,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    })
  })

  it('sends a high-priority, collapsible data message', async () => {
    const { calls, fetch } = fakeFetch()
    const outcome = await createFcmSender(serviceAccount, { fetch })('device-token', signal)
    expect(outcome).toEqual({ ok: true, statusCode: 200 })
    const send = calls[1]!
    expect(send.url).toBe('https://fcm.googleapis.com/v1/projects/woutist-test/messages:send')
    expect(new Headers(send.init.headers).get('authorization')).toBe('Bearer google-access-token')
    expect(JSON.parse(String(send.init.body))).toEqual({
      message: {
        token: 'device-token',
        data: { type: 'changed', listIds: '["L1","L2"]' },
        android: { priority: 'high', collapse_key: 'sync', ttl: '300s' },
      },
    })
  })

  it('reuses the access token until it expires', async () => {
    const { calls, fetch } = fakeFetch()
    const send = createFcmSender(serviceAccount, { fetch })
    await send('a', signal)
    await send('b', signal)
    expect(calls.filter((c) => c.url === serviceAccount.token_uri)).toHaveLength(1)
  })

  it('reports an unregistered token as 404', async () => {
    const { fetch } = fakeFetch(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } })
    const outcome = await createFcmSender(serviceAccount, { fetch })('gone', signal)
    expect(outcome).toMatchObject({ ok: false, statusCode: 404 })
  })
})

describe('parseServiceAccount', () => {
  it('reads the JSON key file Firebase hands out', () => {
    expect(parseServiceAccount(JSON.stringify({ ...serviceAccount, type: 'service_account' }))).toEqual(serviceAccount)
  })

  it('throws on a key without the fields FCM needs', () => {
    expect(() => parseServiceAccount('{"project_id":"x"}')).toThrow()
  })
})
