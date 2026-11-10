import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../platform/native', () => ({ isNative: true }))

const { HourChips } = await import('./HourChips')

const showPicker = vi.fn()
HTMLInputElement.prototype.showPicker = showPicker

afterEach(() => {
  cleanup()
  showPicker.mockReset()
})

const renderIt = () =>
  render(
    <FluentProvider theme={webLightTheme}>
      <HourChips times={['09:00', '13:00']} value={null} onPick={() => {}} size="large" />
    </FluentProvider>,
  )

describe('HourChips in the Android app', () => {
  it('opens the system clock after the field is on screen, not in the tap itself', async () => {
    renderIt()
    fireEvent.click(screen.getByRole('radio', { name: 'Other time' }))
    expect(screen.getByLabelText('Reminder time', { selector: 'input' })).toBeInTheDocument()
    // Opened at once, the clock silently does nothing on the phone: the field isn't laid out yet.
    expect(showPicker).not.toHaveBeenCalled()
    await waitFor(() => expect(showPicker).toHaveBeenCalledTimes(1))
  })

  it('does not reopen the clock when "Other" is tapped to close the field', async () => {
    renderIt()
    const other = screen.getByRole('radio', { name: 'Other time' })
    fireEvent.click(other)
    await waitFor(() => expect(showPicker).toHaveBeenCalledTimes(1))
    fireEvent.click(other)
    expect(screen.queryByLabelText('Reminder time', { selector: 'input' })).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 60))
    expect(showPicker).toHaveBeenCalledTimes(1)
  })

  it('still shows the field when the phone has no picker to open', async () => {
    showPicker.mockImplementation(() => {
      throw new DOMException('no picker', 'NotAllowedError')
    })
    renderIt()
    fireEvent.click(screen.getByRole('radio', { name: 'Other time' }))
    await waitFor(() => expect(showPicker).toHaveBeenCalled())
    expect(screen.getByLabelText('Reminder time', { selector: 'input' })).toBeInTheDocument()
  })
})
