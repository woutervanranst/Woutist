import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { createGraphClient } from '../services/graphClient'
import { type NativeAccount, WoutistAuth } from '../native/plugins'
import { type AuthAdapter, StaticAuthProvider } from './AuthContext'
import { API_SCOPES, GRAPH_SCOPES } from './scopes'

/** MSAL's own refresh margin: a silent call returns the cached token until it is this close to expiry. */
const EXPIRY_MARGIN_MS = 5 * 60_000

type NativeToken = { accessToken: string; expiresOn?: number }

const tokens = new Map<string, { accessToken: string; expiresOn: number }>()
const pending = new Map<string, Promise<string>>()
let generation = 0

/** Forgets every token and detaches in-flight calls (sign-out, other account); their results aren't kept. */
function clearNativeTokens() {
  generation++
  tokens.clear()
  pending.clear()
}

/**
 * The Graph SDK asks for a token on every request, and each native call is an IPC round-trip to the
 * Authenticator broker (~0.8 s). So keep the token per scope set until it nears expiry (that is the token
 * MSAL would hand back anyway), and let concurrent callers share one in-flight call. Without `expiresOn`
 * (older native side) only the sharing applies. Failures are never kept.
 */
function cachedToken(scopes: string[], load: () => Promise<NativeToken>): Promise<string> {
  const key = scopes.join(' ')
  const hit = tokens.get(key)
  if (hit && hit.expiresOn - Date.now() > EXPIRY_MARGIN_MS) return Promise.resolve(hit.accessToken)
  const inFlight = pending.get(key)
  if (inFlight) return inFlight

  const started = generation
  const call: Promise<string> = load()
    .then(({ accessToken, expiresOn }) => {
      if (expiresOn !== undefined && started === generation) tokens.set(key, { accessToken, expiresOn })
      return accessToken
    })
    .finally(() => {
      if (pending.get(key) === call) pending.delete(key)
    })
  pending.set(key, call)
  return call
}

/**
 * Graph token from the Android app's MSAL: silent first, then one sign-in prompt when MSAL says the
 * user must sign in again (concurrent requests share the call, so they wait for the same prompt).
 */
export function nativeGraphToken(): Promise<string> {
  return cachedToken(GRAPH_SCOPES, async () => {
    try {
      return await WoutistAuth.acquireToken({ scopes: GRAPH_SCOPES, interactive: false })
    } catch (error) {
      if ((error as { code?: string } | null)?.code !== 'sign_in_required') throw error
      return WoutistAuth.acquireToken({ scopes: GRAPH_SCOPES, interactive: true })
    }
  })
}

/**
 * Token for Woutist's own API (sync signals), silent only: it's background work and must never open a
 * sign-in prompt. The app registration is the same as the web app's, so its consent covers the scope.
 */
export function nativeApiToken(): Promise<string> {
  return cachedToken(API_SCOPES, () => WoutistAuth.acquireToken({ scopes: API_SCOPES, interactive: false }))
}

/** `AuthAdapter` for the Android app, backed by MSAL Android through the `WoutistAuth` plugin. */
export function NativeAuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<NativeAccount | null>(null)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    let alive = true
    WoutistAuth.getAccount()
      .then((r) => alive && setAccount(r.account))
      .catch((error) => console.warn('Reading the signed-in account failed', error))
      .finally(() => alive && setBusy(false))
    return () => {
      alive = false
    }
  }, [])

  // Another account must never get the previous one's token.
  const accountKey = account?.key
  useEffect(() => {
    clearNativeTokens()
  }, [accountKey])

  const signIn = useCallback(async () => {
    setBusy(true)
    try {
      setAccount(await WoutistAuth.signIn())
    } finally {
      setBusy(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    await WoutistAuth.signOut()
    clearNativeTokens()
    setAccount(null)
  }, [])

  const adapter = useMemo<AuthAdapter>(
    () => ({
      account,
      busy,
      getApiToken: nativeApiToken,
      signIn,
      signOut,
      createGraphClient: () => createGraphClient(nativeGraphToken),
    }),
    [account, busy, signIn, signOut],
  )
  return <StaticAuthProvider adapter={adapter}>{children}</StaticAuthProvider>
}
