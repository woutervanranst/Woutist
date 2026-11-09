import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceRegistration } from './deviceRegistration'

let token: string | null
let calls: string[]
let urls: (string | null)[]
let failPut: boolean
let failHook: boolean
let hookCalls: number
let counter = 0
let registration: DeviceRegistration

beforeEach(() => {
  token = 'fcm-1'
  calls = []
  urls = []
  failPut = false
  failHook = false
  hookCalls = 0
  registration = new DeviceRegistration({
    accountKey: `acct-${++counter}`,
    native: {
      getFcmToken: async () => ({ token }),
      setNotificationUrl: async ({ url }) => {
        urls.push(url)
      },
    },
    api: {
      putDevice: async (t) => {
        calls.push(`put ${t}`)
        if (failPut) throw new Error('offline')
      },
      deleteDevice: async (t) => {
        calls.push(`delete ${t}`)
      },
      getGraphHook: async () => {
        hookCalls++
        if (failHook) throw new Error('CORS')
        return { notificationUrl: 'https://api.test/api/graph-notify?u=user', clientState: 's' }
      },
    },
  })
})

describe('DeviceRegistration', () => {
  it('registers the FCM token and tells native code where subscriptions point', async () => {
    await registration.run()
    expect(calls).toEqual(['put fcm-1'])
    expect(urls).toEqual(['https://api.test/api/graph-notify?u=user'])
  })

  it('registers again only when the token changes', async () => {
    await registration.run()
    await registration.run()
    token = 'fcm-2'
    await registration.run()
    expect(calls).toEqual(['put fcm-1', 'put fcm-2'])
    expect(urls).toHaveLength(1)
  })

  it('retries a registration that failed', async () => {
    failPut = true
    await registration.run()
    failPut = false
    await registration.run()
    expect(calls).toEqual(['put fcm-1', 'put fcm-1'])
  })

  it('registers the token even when fetching the hook fails', async () => {
    failHook = true
    await registration.run()
    expect(calls).toEqual(['put fcm-1'])
    expect(urls).toEqual([])
  })

  it('retries the hook on the next run, without registering the token again', async () => {
    failHook = true
    await registration.run()
    failHook = false
    await registration.run()
    await registration.run()
    expect(urls).toEqual(['https://api.test/api/graph-notify?u=user'])
    expect(hookCalls).toBe(2) // failed once, succeeded once, not asked again
    expect(calls).toEqual(['put fcm-1'])
  })

  it('sets the hook even when registering the token fails, and retries the token', async () => {
    failPut = true
    await registration.run()
    expect(urls).toHaveLength(1)
    failPut = false
    await registration.run()
    expect(calls).toEqual(['put fcm-1', 'put fcm-1'])
    expect(urls).toHaveLength(1)
  })

  it('logs each failing step', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    failHook = true
    failPut = true
    await registration.run()
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('does nothing without Firebase', async () => {
    token = null
    await registration.run()
    expect(calls).toEqual([])
  })

  it('unregisters the token it registered', async () => {
    await registration.run()
    await registration.unregister()
    await registration.unregister()
    expect(calls).toEqual(['put fcm-1', 'delete fcm-1'])
  })
})
