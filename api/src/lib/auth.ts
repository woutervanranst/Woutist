// Validates Entra ID v2 access tokens issued for `api://<ENTRA_CLIENT_ID>/Reminders.ReadWrite`.
// Multi-tenant + personal accounts: the issuer is tenant-specific, so it is checked against `tid`.
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose'
import { API_SCOPE_NAME } from '@woutist/contracts'
import { HttpError, type ApiRequest } from './http'

export const MICROSOFT_JWKS_URL = 'https://login.microsoftonline.com/common/discovery/v2.0/keys'

const ISSUER_RE = /^https:\/\/login\.microsoftonline\.com\/([0-9a-f-]{36})\/v2\.0$/
const OID_RE = /^[0-9a-fA-F-]{36}$/
const MAX_TOKEN_LENGTH = 16 * 1024

export interface AuthenticatedUser {
  tenantId: string
  objectId: string
  /** `${tid}_${oid}`: the PartitionKey of all of this user's rows. */
  userKey: string
}

export type AuthResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; status: 401 | 403; error: string; message: string }

export type Authenticator = (authorizationHeader: string | null | undefined) => Promise<AuthResult>

export interface AuthOptions {
  /** Application (client) id: the `aud` of v2 access tokens for our API. */
  clientId: string
  /** Raw `ALLOWED_USERS` value: comma-separated `tid` or `tid:oid` entries; empty allows everyone. */
  allowedUsers?: string | undefined
  /** Key resolver; defaults to Microsoft's common JWKS endpoint. */
  jwks?: JWTVerifyGetKey
  clockToleranceSeconds?: number
  /** Clock used for `exp`/`nbf` checks (defaults to the system clock). */
  now?: () => Date
}

export interface AllowList {
  tenants: ReadonlySet<string>
  users: ReadonlySet<string>
}

/** `undefined` means "no allowlist configured": everyone with a valid token is allowed. */
export function parseAllowList(raw: string | undefined): AllowList | undefined {
  const entries = (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== '')
  if (entries.length === 0) return undefined
  const tenants = new Set<string>()
  const users = new Set<string>()
  for (const entry of entries) {
    if (entry.includes(':')) users.add(entry)
    else tenants.add(entry)
  }
  return { tenants, users }
}

export function isAllowed(allowList: AllowList | undefined, tenantId: string, objectId: string): boolean {
  if (!allowList) return true
  return allowList.tenants.has(tenantId) || allowList.users.has(`${tenantId}:${objectId}`)
}

let defaultJwks: JWTVerifyGetKey | undefined

function microsoftJwks(): JWTVerifyGetKey {
  defaultJwks ??= createRemoteJWKSet(new URL(MICROSOFT_JWKS_URL))
  return defaultJwks
}

export function createAuthenticator(options: AuthOptions): Authenticator {
  const clientId = options.clientId.trim()
  if (!clientId) throw new Error('ENTRA_CLIENT_ID is not configured.')
  const allowList = parseAllowList(options.allowedUsers)
  const jwks = options.jwks ?? microsoftJwks()
  const clockTolerance = options.clockToleranceSeconds ?? 60

  const unauthorized = (message: string): AuthResult => ({ ok: false, status: 401, error: 'unauthorized', message })
  const forbidden = (error: string, message: string): AuthResult => ({ ok: false, status: 403, error, message })

  return async (authorizationHeader) => {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(authorizationHeader ?? '')
    const token = match?.[1]
    if (!token || token.length > MAX_TOKEN_LENGTH) {
      return unauthorized('A bearer access token is required.')
    }

    let payload: JWTPayload
    try {
      const result = await jwtVerify(token, jwks, {
        audience: clientId,
        algorithms: ['RS256'],
        clockTolerance,
        ...(options.now ? { currentDate: options.now() } : {}),
      })
      payload = result.payload
    } catch {
      return unauthorized('The access token is invalid or expired.')
    }

    const tid = typeof payload['tid'] === 'string' ? payload['tid'] : undefined
    const oid = typeof payload['oid'] === 'string' ? payload['oid'] : undefined
    const issuerTenant = typeof payload.iss === 'string' ? ISSUER_RE.exec(payload.iss)?.[1] : undefined
    if (payload.aud !== clientId) return unauthorized('The access token audience is not accepted.')
    if (!tid || !issuerTenant || issuerTenant !== tid) {
      return unauthorized('The access token issuer is not accepted.')
    }
    if (!oid || !OID_RE.test(oid)) return unauthorized('The access token has no user object id.')

    const scopes = typeof payload['scp'] === 'string' ? payload['scp'].split(' ') : []
    if (!scopes.includes(API_SCOPE_NAME)) {
      return forbidden('insufficient_scope', `The access token lacks the ${API_SCOPE_NAME} scope.`)
    }

    const objectId = oid.toLowerCase()
    if (!isAllowed(allowList, tid, objectId)) {
      return forbidden('forbidden', 'This account is not allowed to use this service.')
    }
    return { ok: true, user: { tenantId: tid, objectId, userKey: `${tid}_${objectId}` } }
  }
}

/** Authenticates the request or throws an {@link HttpError} (401/403). */
export async function requireUser(req: ApiRequest, authenticate: Authenticator): Promise<AuthenticatedUser> {
  const result = await authenticate(req.headers.get('authorization'))
  if (result.ok) return result.user
  const headers: Record<string, string> | undefined =
    result.status === 401
      ? { 'WWW-Authenticate': 'Bearer error="invalid_token"' }
      : result.error === 'insufficient_scope'
        ? { 'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${API_SCOPE_NAME}"` }
        : undefined
  throw new HttpError(result.status, result.error, result.message, headers)
}
