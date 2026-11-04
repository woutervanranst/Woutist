import { beforeAll, describe, expect, it } from 'vitest'
import { parseAllowList } from '../src/lib/auth'
import { handleDeleteMe } from '../src/handlers/api'
import {
  CLIENT_ID,
  createTestContext,
  createTestIssuer,
  makeRequest,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
  type TestIssuer,
} from './helpers'

let issuer: TestIssuer
beforeAll(async () => {
  issuer = await createTestIssuer()
})

describe('authenticator', () => {
  it('accepts a valid v2 access token with the API scope', async () => {
    const result = await issuer.authenticator()(`Bearer ${await issuer.token()}`)
    expect(result).toEqual({
      ok: true,
      user: { tenantId: TENANT_A, objectId: USER_A, userKey: `${TENANT_A}_${USER_A}` },
    })
  })

  it('accepts personal Microsoft accounts (consumer tenant)', async () => {
    const msa = '9188040d-6c67-4c5b-b112-36a304b66dad'
    const result = await issuer.authenticator()(`Bearer ${await issuer.token({ tid: msa })}`)
    expect(result.ok).toBe(true)
  })

  it('rejects a missing or malformed Authorization header', async () => {
    const authenticate = issuer.authenticator()
    for (const header of [null, '', 'Basic abc', 'Bearer', 'Bearer not-a-jwt']) {
      expect(await authenticate(header)).toMatchObject({ ok: false, status: 401 })
    }
  })

  it('rejects a token for another audience', async () => {
    const token = await issuer.token({ aud: '99999999-9999-4999-8999-999999999999' })
    expect(await issuer.authenticator()(`Bearer ${token}`)).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects a v1 audience URI (only the client id GUID is accepted)', async () => {
    const token = await issuer.token({ aud: `api://${CLIENT_ID}` })
    expect(await issuer.authenticator()(`Bearer ${token}`)).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects a foreign or v1 issuer', async () => {
    const authenticate = issuer.authenticator()
    for (const iss of [
      `https://sts.windows.net/${TENANT_A}/`,
      `https://login.microsoftonline.com/${TENANT_A}/v2.0/`,
      `https://evil.example.com/${TENANT_A}/v2.0`,
    ]) {
      expect(await authenticate(`Bearer ${await issuer.token({ iss })}`)).toMatchObject({ ok: false, status: 401 })
    }
  })

  it('rejects an issuer tenant that does not match tid', async () => {
    const token = await issuer.token({ tid: TENANT_A, iss: `https://login.microsoftonline.com/${TENANT_B}/v2.0` })
    expect(await issuer.authenticator()(`Bearer ${token}`)).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects a token without oid', async () => {
    const token = await issuer.token({ oid: '' })
    expect(await issuer.authenticator()(`Bearer ${token}`)).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects a token without the Reminders.ReadWrite scope with 403', async () => {
    const authenticate = issuer.authenticator()
    for (const scp of ['User.Read Tasks.ReadWrite', 'Reminders.Read', undefined]) {
      const token = await issuer.token({ scp, extra: scp === undefined ? { roles: ['Reminders.ReadWrite'] } : {} })
      expect(await authenticate(`Bearer ${token}`)).toMatchObject({ ok: false, status: 403, error: 'insufficient_scope' })
    }
  })

  it('rejects an expired token', async () => {
    const token = await issuer.token({ exp: Math.floor(Date.now() / 1000) - 600 })
    expect(await issuer.authenticator()(`Bearer ${token}`)).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects a token signed with an unknown key', async () => {
    const other = await createTestIssuer()
    expect(await issuer.authenticator()(`Bearer ${await other.token()}`)).toMatchObject({ ok: false, status: 401 })
  })

  it('allows a whole tenant through a tenant allowlist entry', async () => {
    const authenticate = issuer.authenticator({ allowedUsers: ` ${TENANT_A.toUpperCase()} ` })
    expect((await authenticate(`Bearer ${await issuer.token({ tid: TENANT_A, oid: USER_B })}`)).ok).toBe(true)
    expect(await authenticate(`Bearer ${await issuer.token({ tid: TENANT_B })}`)).toMatchObject({
      ok: false,
      status: 403,
      error: 'forbidden',
    })
  })

  it('allows a single user through a tid:oid allowlist entry', async () => {
    const authenticate = issuer.authenticator({ allowedUsers: `${TENANT_B},${TENANT_A}:${USER_A}` })
    expect((await authenticate(`Bearer ${await issuer.token({ tid: TENANT_A, oid: USER_A })}`)).ok).toBe(true)
    expect((await authenticate(`Bearer ${await issuer.token({ tid: TENANT_B, oid: USER_B })}`)).ok).toBe(true)
    expect(await authenticate(`Bearer ${await issuer.token({ tid: TENANT_A, oid: USER_B })}`)).toMatchObject({
      ok: false,
      status: 403,
    })
  })

  it('treats an empty allowlist as "everyone"', () => {
    expect(parseAllowList('')).toBeUndefined()
    expect(parseAllowList(' , ')).toBeUndefined()
    expect(parseAllowList(undefined)).toBeUndefined()
  })
})

describe('HTTP auth errors', () => {
  it('answers 401 with an ApiErrorBody and WWW-Authenticate', async () => {
    const { deps } = await createTestContext()
    const response = await handleDeleteMe(makeRequest({ method: 'DELETE' }), deps)
    expect(response.status).toBe(401)
    expect(response.jsonBody).toMatchObject({ error: 'unauthorized', message: expect.any(String) })
    expect(response.headers?.['WWW-Authenticate']).toContain('Bearer')
  })

  it('answers 403 for a missing scope', async () => {
    const { deps, issuer: ctxIssuer } = await createTestContext()
    const token = await ctxIssuer.token({ scp: 'User.Read' })
    const response = await handleDeleteMe(makeRequest({ method: 'DELETE', token }), deps)
    expect(response.status).toBe(403)
    expect(response.jsonBody).toMatchObject({ error: 'insufficient_scope' })
  })
})
