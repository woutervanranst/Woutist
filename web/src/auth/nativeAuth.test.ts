import { act, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_SCOPES, GRAPH_SCOPES } from './scopes'

const plugin = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  getAccount: vi.fn(),
  acquireToken: vi.fn(),
}))
vi.mock('../native/plugins', () => ({ WoutistAuth: plugin }))

const MINUTE = 60_000
const signInRequired = Object.assign(new Error('Sign-in required'), { code: 'sign_in_required' })

/** A fresh module per test: the token cache is module state. */
async function load() {
  vi.resetModules()
  return import('./nativeAuth')
}

/** A silent native result expiring `minutes` from the (fake) now. */
const token = (accessToken: string, minutes: number) => ({ accessToken, expiresOn: Date.now() + minutes * MINUTE })

beforeEach(() => {
  vi.useFakeTimers()
  for (const fn of Object.values(plugin)) fn.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('native token cache', () => {
  it('reuses a token for sequential calls until it nears expiry', async () => {
    const { nativeGraphToken } = await load()
    plugin.acquireToken.mockResolvedValueOnce(token('t1', 60))
    await expect(nativeGraphToken()).resolves.toBe('t1')
    await expect(nativeGraphToken()).resolves.toBe('t1')
    expect(plugin.acquireToken).toHaveBeenCalledTimes(1)
  })

  it('shares one native call between concurrent callers', async () => {
    const { nativeGraphToken } = await load()
    let finish: (v: unknown) => void = () => {}
    plugin.acquireToken.mockImplementation(() => new Promise((r) => (finish = r)))
    const all = Promise.all([nativeGraphToken(), nativeGraphToken(), nativeGraphToken(), nativeGraphToken()])
    finish(token('shared', 60))
    await expect(all).resolves.toEqual(['shared', 'shared', 'shared', 'shared'])
    expect(plugin.acquireToken).toHaveBeenCalledTimes(1)
  })

  it('fetches again once the token is within 5 minutes of expiry', async () => {
    const { nativeGraphToken } = await load()
    plugin.acquireToken.mockResolvedValueOnce(token('old', 60)).mockResolvedValueOnce(token('new', 60))
    await expect(nativeGraphToken()).resolves.toBe('old')
    vi.advanceTimersByTime(54 * MINUTE)
    await expect(nativeGraphToken()).resolves.toBe('old')
    expect(plugin.acquireToken).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1 * MINUTE + 1)
    await expect(nativeGraphToken()).resolves.toBe('new')
    expect(plugin.acquireToken).toHaveBeenCalledTimes(2)
  })

  it('does not keep a token without expiresOn (older native side)', async () => {
    const { nativeGraphToken } = await load()
    plugin.acquireToken.mockResolvedValueOnce({ accessToken: 'a' }).mockResolvedValueOnce({ accessToken: 'b' })
    await expect(nativeGraphToken()).resolves.toBe('a')
    await expect(nativeGraphToken()).resolves.toBe('b')
    expect(plugin.acquireToken).toHaveBeenCalledTimes(2)
  })

  it('still shares an in-flight call when there is no expiresOn', async () => {
    const { nativeGraphToken } = await load()
    let finish: (v: unknown) => void = () => {}
    plugin.acquireToken.mockImplementation(() => new Promise((r) => (finish = r)))
    const both = Promise.all([nativeGraphToken(), nativeGraphToken()])
    finish({ accessToken: 't' })
    await expect(both).resolves.toEqual(['t', 't'])
    expect(plugin.acquireToken).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failure: the next call retries', async () => {
    const { nativeGraphToken } = await load()
    plugin.acquireToken
      .mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'error' }))
      .mockResolvedValueOnce(token('t', 60))
    await expect(nativeGraphToken()).rejects.toThrow('offline')
    await expect(nativeGraphToken()).resolves.toBe('t')
    expect(plugin.acquireToken).toHaveBeenCalledTimes(2)
  })

  it('opens one shared interactive sign-in on sign_in_required, and caches that token', async () => {
    const { nativeGraphToken } = await load()
    let finish: (v: unknown) => void = () => {}
    plugin.acquireToken.mockImplementation(({ interactive }: { interactive: boolean }) =>
      interactive ? new Promise((r) => (finish = r)) : Promise.reject(signInRequired),
    )
    const both = Promise.all([nativeGraphToken(), nativeGraphToken()])
    await vi.waitFor(() => expect(plugin.acquireToken.mock.calls.filter(([o]) => o.interactive)).toHaveLength(1))
    finish(token('interactive', 60))
    await expect(both).resolves.toEqual(['interactive', 'interactive'])
    expect(plugin.acquireToken.mock.calls.filter(([o]) => o.interactive)).toHaveLength(1)

    const calls = plugin.acquireToken.mock.calls.length
    await expect(nativeGraphToken()).resolves.toBe('interactive')
    expect(plugin.acquireToken).toHaveBeenCalledTimes(calls)
  })

  it('caches Graph and API tokens separately', async () => {
    const { nativeApiToken, nativeGraphToken } = await load()
    plugin.acquireToken.mockImplementation(({ scopes }: { scopes: string[] }) =>
      Promise.resolve(token(scopes[0].startsWith('api://') ? 'api' : 'graph', 60)),
    )
    await expect(nativeGraphToken()).resolves.toBe('graph')
    await expect(nativeApiToken()).resolves.toBe('api')
    await expect(nativeGraphToken()).resolves.toBe('graph')
    await expect(nativeApiToken()).resolves.toBe('api')
    expect(plugin.acquireToken).toHaveBeenCalledTimes(2)
    expect(plugin.acquireToken).toHaveBeenCalledWith({ scopes: GRAPH_SCOPES, interactive: false })
    expect(plugin.acquireToken).toHaveBeenCalledWith({ scopes: API_SCOPES, interactive: false })
  })

  it('clears the cache on sign-out', async () => {
    const { NativeAuthProvider, nativeGraphToken } = await load()
    const account = { key: 'oid.tid', name: 'W', username: 'w@x' }
    plugin.getAccount.mockResolvedValue({ account })
    plugin.signOut.mockResolvedValue(undefined)
    let auth: { signOut(): Promise<void> } | null = null
    const { useAuth } = await import('./AuthContext')
    function Probe() {
      auth = useAuth()
      return null
    }
    render(createElement(NativeAuthProvider, null, createElement(Probe)))
    await vi.waitFor(() => expect(plugin.getAccount).toHaveBeenCalled())

    plugin.acquireToken.mockResolvedValueOnce(token('before', 60)).mockResolvedValueOnce(token('after', 60))
    await expect(nativeGraphToken()).resolves.toBe('before')
    await act(() => auth!.signOut())
    await expect(nativeGraphToken()).resolves.toBe('after')
    expect(plugin.acquireToken).toHaveBeenCalledTimes(2)
  })

  it('clears the cache when the account changes', async () => {
    const { NativeAuthProvider, nativeGraphToken } = await load()
    const first = { key: 'a.tid', name: 'A', username: 'a@x' }
    const second = { key: 'b.tid', name: 'B', username: 'b@x' }
    plugin.getAccount.mockResolvedValue({ account: null })
    plugin.signIn.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    let auth: { signIn(): Promise<void> } | null = null
    const { useAuth } = await import('./AuthContext')
    function Probe() {
      auth = useAuth()
      return null
    }
    render(createElement(NativeAuthProvider, null, createElement(Probe)))
    await vi.waitFor(() => expect(plugin.getAccount).toHaveBeenCalled())
    await act(() => auth!.signIn())

    plugin.acquireToken.mockResolvedValueOnce(token('a', 60)).mockResolvedValueOnce(token('b', 60))
    await expect(nativeGraphToken()).resolves.toBe('a')
    await act(() => auth!.signIn())
    await expect(nativeGraphToken()).resolves.toBe('b')
  })
})
