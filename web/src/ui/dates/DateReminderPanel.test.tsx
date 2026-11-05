import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, todayLocal, zonedWallToInstant } from '../../models/time'
import { newLocalTask, type Task } from '../../models/todo'

const services = vi.hoisted(() => ({
  accountKey: 'panel-test',
  repo: { updateTask: vi.fn(async () => {}) },
  db: { tasks: { get: vi.fn() }, getMeta: vi.fn() },
}))
vi.mock('../../app/AppServices', () => ({ useServices: () => services }))

const { DateReminderPanel } = await import('./DateReminderPicker')
const { useDateEditor } = await import('./useDateEditor')

function Harness({ task, onClose }: { task: Task; onClose: () => void }) {
  const editor = useDateEditor(task)
  return <DateReminderPanel task={task} editor={editor} onClose={onClose} />
}

const today = todayLocal()
const tomorrow = addDays(today, 1)
const at = (date: string, time: string) => zonedWallToInstant(`${date}T${time}:00`, 'Europe/Brussels').toISOString()

const renderIt = (task: Task, onClose = vi.fn()) => {
  render(
    <FluentProvider theme={webLightTheme}>
      <Harness task={task} onClose={onClose} />
    </FluentProvider>,
  )
  return onClose
}

afterEach(cleanup)
beforeEach(() => services.repo.updateTask.mockClear())

describe('DateReminderPanel', () => {
  it('applies a quick date and stays open for the hour, which then lands on that date', () => {
    const task = newLocalTask('L1', 'Call the plumber')
    const onClose = renderIt(task)
    expect(screen.getByText('No date')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Tomorrow/ }))
    expect(services.repo.updateTask).toHaveBeenLastCalledWith(task.id, { dueDate: tomorrow })
    expect(onClose).not.toHaveBeenCalled()

    // The stored task hasn't caught up yet; the hour still goes on the picked date.
    fireEvent.click(screen.getByRole('radio', { name: /^9:00/ }))
    expect(services.repo.updateTask).toHaveBeenLastCalledWith(task.id, { reminderAt: at(tomorrow, '09:00'), isReminderOn: true })
    expect(onClose).toHaveBeenCalled()
  })

  it('moves an existing reminder along with the date', () => {
    const task = { ...newLocalTask('L1', 'Reply'), dueDate: today, reminderAt: at(today, '13:00'), isReminderOn: true }
    renderIt(task)
    expect(screen.getByRole('radio', { name: /^1:00/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: /^Tomorrow/ }))
    expect(services.repo.updateTask).toHaveBeenLastCalledWith(task.id, {
      dueDate: tomorrow,
      reminderAt: at(tomorrow, '13:00'),
      isReminderOn: true,
    })
  })

  it('removes the date and the reminder', () => {
    const task = { ...newLocalTask('L1', 'Reply'), dueDate: today, reminderAt: at(today, '13:00'), isReminderOn: true }
    const onClose = renderIt(task)
    fireEvent.click(screen.getByRole('button', { name: 'Remove date and reminder' }))
    expect(services.repo.updateTask).toHaveBeenLastCalledWith(task.id, { dueDate: null, reminderAt: null, isReminderOn: false })
    expect(onClose).toHaveBeenCalled()
  })

  it('sets any other time from the clock chip', () => {
    const task = { ...newLocalTask('L1', 'Reply'), dueDate: tomorrow }
    renderIt(task)
    fireEvent.click(screen.getByRole('radio', { name: 'Other time' }))
    fireEvent.change(screen.getByLabelText('Reminder time', { selector: 'input' }), { target: { value: '07:45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))
    expect(services.repo.updateTask).toHaveBeenLastCalledWith(task.id, { reminderAt: at(tomorrow, '07:45'), isReminderOn: true })
  })

  it('opens a calendar for any other date', () => {
    const task = newLocalTask('L1', 'Renew passport')
    renderIt(task)
    fireEvent.click(screen.getByRole('button', { name: 'Pick a date…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    const [y, m] = today.split('-').map(Number)
    const next = new Date(Date.UTC(y, m, 15))
    const label = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeZone: 'UTC' }).format(next)
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(services.repo.updateTask).toHaveBeenLastCalledWith(task.id, { dueDate: next.toISOString().slice(0, 10) })
  })
})
