import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  getStatus: vi.fn(),
  requestNotificationPermission: vi.fn(),
  openSystemSettings: vi.fn(async () => {}),
  showPastReminders: vi.fn(),
}))
vi.mock('../../native/plugins', () => ({ WoutistNative: native }))

const { NativeNotificationSettings } = await import('./NativeNotificationSettings')

const renderIt = () =>
  render(
    <FluentProvider theme={webLightTheme}>
      <NativeNotificationSettings />
    </FluentProvider>,
  )

afterEach(cleanup)

beforeEach(() => {
  native.getStatus.mockReset().mockResolvedValue({ notifications: false, exactAlarms: true, batteryUnrestricted: false })
  native.requestNotificationPermission.mockReset().mockResolvedValue({ granted: false })
  native.openSystemSettings.mockClear()
  native.showPastReminders.mockReset().mockResolvedValue({ count: 3 })
})

describe('NativeNotificationSettings', () => {
  it('shows what the phone allows', async () => {
    renderIt()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Allow notifications' })).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Allow exact reminders' })).toBeDisabled()
    expect(screen.getByRole('button', { name: "Don't restrict battery (OnePlus)" })).toBeEnabled()
    expect(screen.getByText(/official Microsoft To Do app/)).toBeInTheDocument()
  })

  it('asks for notifications, then opens the settings when Android no longer asks', async () => {
    renderIt()
    const button = await screen.findByRole('button', { name: 'Allow notifications' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(native.openSystemSettings).toHaveBeenCalledWith({ target: 'notifications' }))
    expect(native.requestNotificationPermission).toHaveBeenCalled()
  })

  it('opens the battery settings', async () => {
    renderIt()
    const button = await screen.findByRole('button', { name: "Don't restrict battery (OnePlus)" })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(native.openSystemSettings).toHaveBeenCalledWith({ target: 'battery' }))
  })

  it('refreshes when coming back from the system settings', async () => {
    renderIt()
    await screen.findByRole('button', { name: 'Allow notifications' })
    native.getStatus.mockResolvedValue({ notifications: true, exactAlarms: true, batteryUnrestricted: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Allow notifications' })).toBeDisabled())
  })

  it('shows the past reminders again and says how many', async () => {
    renderIt()
    fireEvent.click(await screen.findByRole('button', { name: 'Show past reminders again' }))
    expect(await screen.findByText('Showed 3 reminders.')).toBeInTheDocument()
    expect(native.showPastReminders).toHaveBeenCalledTimes(1)
  })

  it('says so when no reminder has come due', async () => {
    native.showPastReminders.mockResolvedValue({ count: 0 })
    renderIt()
    fireEvent.click(await screen.findByRole('button', { name: 'Show past reminders again' }))
    expect(await screen.findByText(/No reminders have come due/)).toBeInTheDocument()
  })

  it('shows why it could not, e.g. notifications being off', async () => {
    native.showPastReminders.mockRejectedValue(new Error('Notifications are off for Woutist.'))
    renderIt()
    fireEvent.click(await screen.findByRole('button', { name: 'Show past reminders again' }))
    expect(await screen.findByText('Notifications are off for Woutist.')).toBeInTheDocument()
  })
})
