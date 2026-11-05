import { act, render, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => {
  const listeners = new Map<string, (e: { url: string }) => void>()
  return {
    listeners,
    isNative: true,
    consumeLaunchUrl: vi.fn(async (): Promise<{ url: string | null }> => ({ url: null })),
    addListener: vi.fn(async (event: string, cb: (e: { url: string }) => void) => {
      listeners.set(event, cb)
      return { remove: async () => void listeners.delete(event) }
    }),
  }
})
vi.mock('../native/plugins', () => ({ WoutistNative: native }))
vi.mock('./native', () => ({
  get isNative() {
    return native.isNative
  },
}))

const { usePlatformNavigation } = await import('./navigation')

function renderAt(path: string) {
  const seen = { current: '' }
  function Probe() {
    usePlatformNavigation()
    const loc = useLocation()
    seen.current = loc.pathname + loc.search
    return null
  }
  render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
    </MemoryRouter>,
  )
  return seen
}

beforeEach(() => {
  native.listeners.clear()
  native.consumeLaunchUrl.mockReset().mockResolvedValue({ url: null })
})

describe('usePlatformNavigation on Android', () => {
  it('opens the task a notification was tapped for at launch', async () => {
    native.consumeLaunchUrl.mockResolvedValue({ url: '/lists/L%3D1?task=T1' })
    const seen = renderAt('/')
    await waitFor(() => expect(seen.current).toBe('/lists/L%3D1?task=T1'))
  })

  it('follows notification taps while running', async () => {
    const seen = renderAt('/')
    await waitFor(() => expect(native.listeners.has('navigate')).toBe(true))
    act(() => native.listeners.get('navigate')!({ url: '/lists/L2?task=T2' }))
    expect(seen.current).toBe('/lists/L2?task=T2')
  })

  it('stays put when there is no launch url', async () => {
    const seen = renderAt('/important')
    await waitFor(() => expect(native.consumeLaunchUrl).toHaveBeenCalled())
    expect(seen.current).toBe('/important')
  })
})
