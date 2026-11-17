import { BrowserAuthError, BrowserAuthErrorCodes, InteractionRequiredAuthError } from '@azure/msal-browser'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const msal = vi.hoisted(() => ({
  getActiveAccount: vi.fn(),
  acquireTokenSilent: vi.fn(),
  acquireTokenRedirect: vi.fn(),
}))
vi.mock('./msal', () => ({ msalInstance: msal }))

const { getAccessToken } = await import('./tokens')

const account = { homeAccountId: 'oid.tid', username: 'w@x' }
const scopes = ['Tasks.ReadWrite']

beforeEach(() => {
  for (const fn of Object.values(msal)) fn.mockReset()
  msal.getActiveAccount.mockReturnValue(account)
  msal.acquireTokenRedirect.mockResolvedValue(undefined)
})

describe('getAccessToken', () => {
  it('returns the silently acquired token', async () => {
    msal.acquireTokenSilent.mockResolvedValue({ accessToken: 'silent-token' })
    await expect(getAccessToken(scopes)).resolves.toBe('silent-token')
    expect(msal.acquireTokenRedirect).not.toHaveBeenCalled()
  })

  it('signs in again when MSAL says interaction is required', async () => {
    msal.acquireTokenSilent.mockRejectedValue(new InteractionRequiredAuthError('interaction_required', ''))
    void getAccessToken(scopes)
    await vi.waitFor(() => expect(msal.acquireTokenRedirect).toHaveBeenCalledWith({ scopes, account }))
  })

  // Brave/Safari hide the Microsoft session from the hidden renewal iframe; it never returns.
  it('signs in again when the hidden renewal iframe times out', async () => {
    msal.acquireTokenSilent.mockRejectedValue(
      new BrowserAuthError(BrowserAuthErrorCodes.timedOut, '', 'redirect_bridge_timeout'),
    )
    void getAccessToken(scopes)
    await vi.waitFor(() => expect(msal.acquireTokenRedirect).toHaveBeenCalledWith({ scopes, account }))
  })

  it('rethrows other errors without signing in', async () => {
    msal.acquireTokenSilent.mockRejectedValue(new Error('offline'))
    await expect(getAccessToken(scopes)).rejects.toThrow('offline')
    expect(msal.acquireTokenRedirect).not.toHaveBeenCalled()
  })
})
