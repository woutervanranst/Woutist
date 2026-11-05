import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  getStatus: vi.fn(),
  requestNotificationPermission: vi.fn(),
  openSystemSettings: vi.fn(async () => {}),
}))
vi.mock('../../native/plugins', () => ({ WoutistNative: native }))

const { ReminderHealthBanner } = await import('./ReminderHealthBanner')

const renderIt = (active = true) =>
  render(
    <FluentProvider theme={webLightTheme}>
      <ReminderHealthBanner accountKey="acc" active={active} />
    </FluentProvider>,
  )

afterEach(() => {
  cleanup()
  localStorage.clear()
})

beforeEach(() => {
  native.getStatus.mockReset().mockResolvedValue({ notifications: true, exactAlarms: true, batteryUnrestricted: false })
  native.openSystemSettings.mockClear()
})

describe('ReminderHealthBanner', () => {
  it('asks to allow background activity when the battery is restricted', async () => {
    renderIt()
    fireEvent.click(await screen.findByRole('button', { name: 'Allow background activity' }))
    await waitFor(() => expect(native.openSystemSettings).toHaveBeenCalledWith({ target: 'battery' }))
    expect(screen.getByText(/hold back reminders/)).toBeInTheDocument()
  })

  it('stays hidden without upcoming reminders', async () => {
    renderIt(false)
    await waitFor(() => expect(native.getStatus).toHaveBeenCalled())
    expect(screen.queryByText(/hold back reminders/)).not.toBeInTheDocument()
  })

  it('stays hidden when the phone allows everything', async () => {
    native.getStatus.mockResolvedValue({ notifications: true, exactAlarms: true, batteryUnrestricted: true })
    renderIt()
    await waitFor(() => expect(native.getStatus).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument()
  })

  it('"Not now" hides it, also after a restart', async () => {
    renderIt()
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    expect(screen.queryByText(/hold back reminders/)).not.toBeInTheDocument()
    cleanup()
    renderIt()
    await waitFor(() => expect(native.getStatus).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/hold back reminders/)).not.toBeInTheDocument()
  })
})
