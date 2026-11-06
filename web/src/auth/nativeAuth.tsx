import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { createGraphClient } from '../services/graphClient'
import { type NativeAccount, WoutistAuth } from '../native/plugins'
import { type AuthAdapter, StaticAuthProvider } from './AuthContext'
import { API_SCOPES, GRAPH_SCOPES } from './scopes'

let interactive: Promise<string> | null = null

/**
 * Graph token from the Android app's MSAL: silent first, then one shared interactive sign-in when
 * MSAL says the user must sign in again (concurrent requests wait for the same prompt).
 */
export async function nativeGraphToken(): Promise<string> {
  try {
    return (await WoutistAuth.acquireToken({ scopes: GRAPH_SCOPES, interactive: false })).accessToken
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== 'sign_in_required') throw error
    interactive ??= WoutistAuth.acquireToken({ scopes: GRAPH_SCOPES, interactive: true })
      .then((r) => r.accessToken)
      .finally(() => {
        interactive = null
      })
    return interactive
  }
}

/**
 * Token for Woutist's own API (sync signals), silent only: it's background work and must never open a
 * sign-in prompt. The app registration is the same as the web app's, so its consent covers the scope.
 */
export async function nativeApiToken(): Promise<string> {
  return (await WoutistAuth.acquireToken({ scopes: API_SCOPES, interactive: false })).accessToken
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
