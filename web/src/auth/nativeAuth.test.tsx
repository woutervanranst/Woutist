import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth, type AuthAdapter } from './AuthContext'

const plugin = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  getAccount: vi.fn(),
  acquireToken: vi.fn(),
}))
vi.mock('../native/plugins', () => ({ WoutistAuth: plugin }))

const { NativeAuthProvider, nativeApiToken, nativeGraphToken } = await import('./nativeAuth')

const account = { key: 'oid.tid', name: 'W', username: 'w@x' }
const signInRequired = Object.assign(new Error('Sign-in required'), { code: 'sign_in_required' })

function renderProvider() {
  const seen: { current: AuthAdapter | null } = { current: null }
  function Probe() {
    seen.current = useAuth()
    return null
  }
  render(
    <NativeAuthProvider>
      <Probe />
    </NativeAuthProvider>,
  )
  return seen
}

beforeEach(() => {
  for (const fn of Object.values(plugin)) fn.mockReset()
})

describe('nativeGraphToken', () => {
  it('graphTokenFallsBackToInteractive', async () => {
    plugin.acquireToken
      .mockRejectedValueOnce(signInRequired)
      .mockResolvedValueOnce({ accessToken: 'interactive-token' })
    await expect(nativeGraphToken()).resolves.toBe('interactive-token')
    expect(plugin.acquireToken).toHaveBeenNthCalledWith(1, expect.objectContaining({ interactive: false }))
    expect(plugin.acquireToken).toHaveBeenNthCalledWith(2, expect.objectContaining({ interactive: true }))
  })

  it('opens one interactive sign-in for concurrent requests', async () => {
    let finish: (v: { accessToken: string }) => void = () => {}
    plugin.acquireToken.mockImplementation(({ interactive }: { interactive: boolean }) =>
      interactive ? new Promise((r) => (finish = r)) : Promise.reject(signInRequired),
    )
    const both = Promise.all([nativeGraphToken(), nativeGraphToken()])
    await waitFor(() => expect(plugin.acquireToken.mock.calls.filter(([o]) => o.interactive)).toHaveLength(1))
    finish({ accessToken: 't' })
    await expect(both).resolves.toEqual(['t', 't'])
  })

  it('does not prompt for other errors', async () => {
    plugin.acquireToken.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'network' }))
    await expect(nativeGraphToken()).rejects.toThrow('offline')
    expect(plugin.acquireToken).toHaveBeenCalledTimes(1)
  })
})

describe('nativeApiToken', () => {
  it("asks MSAL silently for the API's scope", async () => {
    plugin.acquireToken.mockResolvedValueOnce({ accessToken: 'api-token' })
    await expect(nativeApiToken()).resolves.toBe('api-token')
    expect(plugin.acquireToken).toHaveBeenCalledWith({
      scopes: [expect.stringMatching(/^api:\/\/.+\/Reminders\.ReadWrite$/)],
      interactive: false,
    })
  })

  it('never prompts: sync signals are background work', async () => {
    plugin.acquireToken.mockRejectedValueOnce(signInRequired)
    await expect(nativeApiToken()).rejects.toBe(signInRequired)
    expect(plugin.acquireToken).toHaveBeenCalledTimes(1)
  })
})

describe('NativeAuthProvider', () => {
  it('exposesAccount', async () => {
    plugin.getAccount.mockResolvedValue({ account })
    const auth = renderProvider()
    await waitFor(() => expect(auth.current?.account).toEqual(account))
    expect(auth.current?.busy).toBe(false)
  })

  it('signOutClearsAccount', async () => {
    plugin.getAccount.mockResolvedValue({ account })
    plugin.signOut.mockResolvedValue(undefined)
    const auth = renderProvider()
    await waitFor(() => expect(auth.current?.account).toEqual(account))
    await act(() => auth.current!.signOut())
    expect(auth.current?.account).toBeNull()
  })

  it('signs in and exposes the new account', async () => {
    plugin.getAccount.mockResolvedValue({ account: null })
    plugin.signIn.mockResolvedValue(account)
    const auth = renderProvider()
    await waitFor(() => expect(auth.current?.busy).toBe(false))
    expect(auth.current?.account).toBeNull()
    await act(() => auth.current!.signIn())
    expect(auth.current?.account).toEqual(account)
  })

  it('gets API tokens (sync signals) from native MSAL', async () => {
    plugin.getAccount.mockResolvedValue({ account })
    const auth = renderProvider()
    await waitFor(() => expect(auth.current?.account).toEqual(account))
    plugin.acquireToken.mockResolvedValueOnce({ accessToken: 'api-token' })
    await expect(auth.current!.getApiToken()).resolves.toBe('api-token')
  })
})
