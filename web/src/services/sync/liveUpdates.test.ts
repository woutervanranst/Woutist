import { describe, expect, it, vi } from 'vitest'
import { LiveUpdates } from './liveUpdates'

describe('LiveUpdates', () => {
  it('is unavailable without an API (and in the demo), whatever it is told', () => {
    const live = new LiveUpdates(false)
    live.setConnection(true)
    live.setSubscriptions(true)
    expect(live.getState()).toEqual({ state: 'unavailable' })
  })

  it('is on only with a connection and good subscriptions', () => {
    const live = new LiveUpdates(true)
    expect(live.getState().state).toBe('off')
    live.setConnection(true)
    expect(live.getState()).toMatchObject({ state: 'off', reason: expect.stringContaining('notifications') })
    live.setSubscriptions(true)
    expect(live.getState()).toEqual({ state: 'on' })
  })

  it('gives the reason of the connection when it is the problem', () => {
    const live = new LiveUpdates(true)
    live.setSubscriptions(true)
    live.setConnection(false, "Couldn't register this phone: Failed to fetch")
    expect(live.getState()).toEqual({ state: 'off', reason: "Couldn't register this phone: Failed to fetch" })
    live.setConnection(false)
    expect(live.getState().reason).toBeTruthy()
  })

  it('says when Microsoft subscriptions failed', () => {
    const live = new LiveUpdates(true)
    live.setConnection(true)
    live.setSubscriptions(false)
    expect(live.getState()).toMatchObject({ state: 'off', reason: expect.stringContaining('Microsoft') })
  })

  it('notifies subscribers only when the state changes, and keeps the same object otherwise', () => {
    const live = new LiveUpdates(true)
    const listener = vi.fn()
    const off = live.subscribe(listener)
    live.setConnection(true)
    live.setSubscriptions(true)
    const on = live.getState()
    live.setConnection(true)
    live.setSubscriptions(true)
    expect(live.getState()).toBe(on)
    expect(listener).toHaveBeenCalledTimes(2) // reason changed, then on; telling it the same again is no change
    off()
    live.setConnection(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
