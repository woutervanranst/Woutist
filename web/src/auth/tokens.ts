import { InteractionRequiredAuthError } from '@azure/msal-browser'
import { msalInstance } from './msal'
import { API_SCOPES, GRAPH_SCOPES, LOGIN_REQUEST } from './scopes'

export class NotSignedInError extends Error {
  constructor() {
    super('No signed-in account')
    this.name = 'NotSignedInError'
  }
}

/**
 * Get an access token silently (cache → refresh token → hidden iframe via the redirect bridge).
 * If user interaction is required, starts a redirect; the returned promise never resolves then.
 */
export async function getAccessToken(scopes: string[]): Promise<string> {
  const account = msalInstance.getActiveAccount()
  if (!account) throw new NotSignedInError()
  try {
    const result = await msalInstance.acquireTokenSilent({ scopes, account })
    return result.accessToken
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      await msalInstance.acquireTokenRedirect({ scopes, account })
      return new Promise<string>(() => {})
    }
    throw error
  }
}

export const getGraphToken = () => getAccessToken(GRAPH_SCOPES)
export const getApiToken = () => getAccessToken(API_SCOPES)

export function signIn(): Promise<void> {
  return msalInstance.loginRedirect({ ...LOGIN_REQUEST, prompt: 'select_account' })
}

export function signOut(): Promise<void> {
  const account = msalInstance.getActiveAccount() ?? undefined
  return msalInstance.logoutRedirect({ account })
}

/** Stable per-account key, used to partition local data (IndexedDB, preferences). */
export function activeAccountKey(): string | null {
  return msalInstance.getActiveAccount()?.homeAccountId ?? null
}
