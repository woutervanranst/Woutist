import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPrefs } from '../../app/prefs'
import { zonedWallToInstant } from '../../models/time'
import { newLocalTask, type Task } from '../../models/todo'

const NOW = zonedWallToInstant('2026-11-10T14:30:00', 'Europe/Brussels')
const at = (wall: string) => zonedWallToInstant(wall, 'Europe/Brussels').toISOString()

const state = vi.hoisted(() => ({ tasks: [] as Task[] }))
const services = vi.hoisted(() => ({
  accountKey: 'bell-test',
  repo: { updateTask: vi.fn(async () => {}) },
  db: {},
}))

vi.mock('../../app/AppServices', () => ({ useServices: () => services }))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => state.tasks }))
vi.mock('../hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks')>()),
  useNow: () => NOW,
  useLists: () => [
    { id: 'L1', displayName: 'Groceries', wellknownListName: 'none', isOwner: true, isShared: false, sortIndex: 0 },
  ],
}))

const { ReminderBell } = await import('./ReminderBell')

function make(id: string, title: string, reminder: string, extra: Partial<Task> = {}): Task {
  return { ...newLocalTask('L1', title), id, isReminderOn: true, reminderAt: at(reminder), ...extra }
}

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
}

const renderIt = () =>
  render(
    <MemoryRouter>
      <FluentProvider theme={webLightTheme}>
        <ReminderBell />
        <Where />
      </FluentProvider>
    </MemoryRouter>,
  )

const openBell = (name: string | RegExp = /^Reminders/) => fireEvent.click(screen.getByRole('button', { name }))
const dismissedInStorage = () => JSON.parse(localStorage.getItem('woutist:prefs:bell-test') ?? '{}').dismissedReminders

beforeEach(() => {
  services.repo.updateTask.mockClear()
  state.tasks = [
    make('a', 'Call the dentist', '2026-11-10T14:00:00'),
    make('b', 'Submit expense report', '2026-11-10T09:00:00'),
    make('later', 'Not due yet', '2026-11-10T18:00:00'),
    make('done', 'Already done', '2026-11-10T08:00:00', { status: 'completed', completed: 1 }),
  ]
})
afterEach(() => {
  cleanup()
  clearPrefs('bell-test')
})

describe('ReminderBell', () => {
  it('counts the reminders that are due and lists them, newest first', () => {
    renderIt()
    openBell('Reminders, 2 due')
    const titles = screen.getAllByRole('button', { name: /Call the dentist|Submit expense report/ }).map((b) => b.textContent)
    expect(titles).toEqual(['Call the dentist', 'Submit expense report'])
    expect(screen.queryByText('Not due yet')).not.toBeInTheDocument()
    expect(screen.queryByText('Already done')).not.toBeInTheDocument()
    expect(screen.getByText('30 min ago')).toBeInTheDocument()
    expect(screen.getAllByText('Groceries')).toHaveLength(2)
  })

  it('says so when nothing is due', () => {
    state.tasks = []
    renderIt()
    openBell('Reminders')
    expect(screen.getByText('No reminders right now')).toBeInTheDocument()
  })

  it('dismisses one reminder on this device only', () => {
    renderIt()
    openBell('Reminders, 2 due')
    fireEvent.click(within(screen.getByText('Call the dentist').closest('div')!.parentElement!).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Call the dentist')).not.toBeInTheDocument()
    expect(screen.getByText('Submit expense report')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reminders, 1 due' })).toBeInTheDocument()
    expect(dismissedInStorage()).toEqual({ a: at('2026-11-10T14:00:00') })
    expect(services.repo.updateTask).not.toHaveBeenCalled()
  })

  it('dismisses everything at once', () => {
    renderIt()
    openBell('Reminders, 2 due')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss all' }))
    expect(screen.getByText('No reminders right now')).toBeInTheDocument()
    expect(Object.keys(dismissedInStorage()).sort()).toEqual(['a', 'b'])
  })

  it('snoozes by moving the reminder itself, so it is saved to Microsoft To Do', async () => {
    renderIt()
    openBell('Reminders, 2 due')
    fireEvent.click(within(screen.getByText('Call the dentist').closest('div')!.parentElement!).getByRole('button', { name: 'Snooze' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '10 minutes' }))
    expect(services.repo.updateTask).toHaveBeenCalledWith('a', {
      reminderAt: new Date(NOW.getTime() + 10 * 60_000).toISOString(),
      isReminderOn: true,
    })
  })

  it('offers the next reminder time of today and the first of tomorrow', async () => {
    renderIt()
    openBell('Reminders, 2 due')
    fireEvent.click(within(screen.getByText('Call the dentist').closest('div')!.parentElement!).getByRole('button', { name: 'Snooze' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Later today/ }))
    expect(services.repo.updateTask).toHaveBeenCalledWith('a', { reminderAt: at('2026-11-10T18:00:00'), isReminderOn: true })
  })

  it('opens the task when its title is clicked', () => {
    renderIt()
    openBell('Reminders, 2 due')
    fireEvent.click(screen.getByRole('button', { name: 'Submit expense report' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/lists/L1?task=b')
  })
})
