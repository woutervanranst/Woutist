import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newLocalTask, type Task } from '../../models/todo'

const START = new Date('2026-11-10T14:00:00Z')
const showNotification = vi.fn(async () => {})
const services = vi.hoisted(() => ({
  tasks: [] as Task[],
  pushState: 'off' as 'on' | 'off',
}))

vi.mock('../../app/AppServices', () => ({
  useServices: () => ({
    repo: { updateTask: vi.fn() },
    push: { state: () => services.pushState },
    db: {
      tasks: {
        filter: (fn: (t: Task) => boolean) => ({ toArray: async () => services.tasks.filter(fn) }),
        get: vi.fn(),
      },
    },
  }),
}))

const { useInAppReminders } = await import('./useInAppReminders')

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
  showNotification.mockClear()
  // A reminder that comes due 10 s after the app opened, so the next 20 s check finds it.
  services.tasks = [
    { ...newLocalTask('L1', 'Call the dentist'), id: 'a', isReminderOn: true, reminderAt: new Date(START.getTime() + 10_000).toISOString() },
  ]
  vi.stubGlobal('Notification', { permission: 'granted' })
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: async () => ({ showNotification }) },
  })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

describe('useInAppReminders', () => {
  it('shows a system notification for a reminder that comes due while the tab is hidden and push is off', async () => {
    renderHook(() => useInAppReminders(), { wrapper })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(showNotification).toHaveBeenCalledWith('Call the dentist', expect.objectContaining({ tag: 'reminder:a' }))
  })

  it('stays quiet when push already delivers reminders', async () => {
    services.pushState = 'on'
    renderHook(() => useInAppReminders(), { wrapper })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(showNotification).not.toHaveBeenCalled()
    services.pushState = 'off'
  })

  it('stays quiet while the app is on screen: the bell shows the reminder', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    renderHook(() => useInAppReminders(), { wrapper })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(showNotification).not.toHaveBeenCalled()
  })
})
