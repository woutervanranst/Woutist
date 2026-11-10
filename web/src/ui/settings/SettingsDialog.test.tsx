import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS } from '../../app/prefs'

const setStartPage = vi.fn()
vi.mock('../hooks', () => ({
  useAccountPrefs: () => [DEFAULT_PREFS, () => {}],
  useStartPage: () => ['tasks', setStartPage],
}))
vi.mock('./DateReminderSettings', () => ({ DateReminderSettings: () => <div>dates</div> }))
vi.mock('./CategorySettings', () => ({ CategorySettings: () => <div>categories</div> }))
vi.mock('./SyncSettings', () => ({ SyncSettings: () => <div>sync section</div> }))
vi.stubGlobal('__APP_VERSION__', 'test')

const { SettingsDialog } = await import('./SettingsDialog')

const scrolled = vi.fn()
beforeEach(() => {
  scrolled.mockReset()
  setStartPage.mockReset()
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled(this.textContent)
  }
})
afterEach(cleanup)

const show = (scrollTo?: 'sync') =>
  render(
    <FluentProvider theme={webLightTheme}>
      <SettingsDialog open onClose={() => {}} scrollTo={scrollTo} extra={<div>notifications</div>} />
    </FluentProvider>,
  )

describe('SettingsDialog', () => {
  it('has the Sync section after General, and no "Sync everything now" button any more', () => {
    show()
    const text = document.body.textContent!
    expect(text.indexOf('Confirm before deleting')).toBeLessThan(text.indexOf('sync section'))
    expect(text.indexOf('sync section')).toBeLessThan(text.indexOf('notifications'))
    expect(screen.queryByRole('button', { name: 'Sync everything now' })).toBeNull()
  })

  it('opens scrolled to the Sync section when asked to', () => {
    show('sync')
    expect(scrolled).toHaveBeenCalledWith('sync section')
  })

  it('does not scroll when opened normally', () => {
    show()
    expect(scrolled).not.toHaveBeenCalled()
  })

  it('lets you choose where the app opens: Tasks, or a smart list', () => {
    show()
    const select = screen.getByRole('combobox', { name: 'Open the app on' })
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.textContent)).toEqual([
      'Tasks',
      'Today',
      'Important',
      'Planned',
      'All',
      'Completed',
    ])
    expect((select as HTMLSelectElement).value).toBe('tasks')
    fireEvent.change(select, { target: { value: 'today' } })
    expect(setStartPage).toHaveBeenCalledWith('today')
  })
})
