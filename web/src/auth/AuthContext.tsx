import { InteractionStatus, type PublicClientApplication } from '@azure/msal-browser'
import { MsalProvider, useMsal } from '@azure/msal-react'
import type { Client } from '@microsoft/microsoft-graph-client'
import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react'
import { createGraphClient } from '../services/graphClient'
import { getApiToken, getGraphToken, signIn, signOut } from './tokens'

export interface AuthAccount {
  /** Stable per-account key (MSAL homeAccountId); partitions local data. */
  key: string
  name: string
  username: string
}

/**
 * Everything the app needs from the platform's sign-in. MSAL.js implements it on the web; a
 * Capacitor/MSAL-Android adapter can implement it later without touching the rest of the app.
 */
export interface AuthAdapter {
  account: AuthAccount | null
  /** A sign-in/redirect is in progress. */
  busy: boolean
  getApiToken(): Promise<string>
  signIn(): Promise<void>
  signOut(): Promise<void>
  createGraphClient(): Client
}

const AuthContext = createContext<AuthAdapter | null>(null)

export function useAuth(): AuthAdapter {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside an auth provider')
  return ctx
}

export function StaticAuthProvider({ adapter, children }: { adapter: AuthAdapter; children: ReactNode }) {
  return <AuthContext.Provider value={adapter}>{children}</AuthContext.Provider>
}

export function MsalAuthProvider({ instance, children }: { instance: PublicClientApplication; children: ReactNode }) {
  return (
    <MsalProvider instance={instance}>
      <MsalBridge>{children}</MsalBridge>
    </MsalProvider>
  )
}

function MsalBridge({ children }: { children: ReactNode }) {
  const { instance, accounts, inProgress } = useMsal()
  const active = instance.getActiveAccount() ?? accounts[0] ?? null

  useEffect(() => {
    if (active && !instance.getActiveAccount()) instance.setActiveAccount(active)
  }, [active, instance])

  const key = active?.homeAccountId
  const name = active?.name
  const username = active?.username
  const busy = inProgress !== InteractionStatus.None

  const adapter = useMemo<AuthAdapter>(
    () => ({
      account: key ? { key, name: name || username || '', username: username ?? '' } : null,
      busy,
      getApiToken,
      signIn,
      signOut,
      createGraphClient: () => createGraphClient(getGraphToken),
    }),
    [key, name, username, busy],
  )
  return <AuthContext.Provider value={adapter}>{children}</AuthContext.Provider>
}
