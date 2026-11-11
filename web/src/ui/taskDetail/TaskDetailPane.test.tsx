import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS } from '../../app/prefs'
import { todayLocal } from '../../models/time'
import { newLocalTask, type Step, type Task } from '../../models/todo'

const state = vi.hoisted(() => ({ task: null as Task | null }))
const repo = vi.hoisted(() => ({ updateStep: vi.fn(), updateTask: vi.fn() }))

vi.mock('../../app/AppServices', () => ({
  useServices: () => ({ accountKey: 'steps-test', repo, engine: { refreshAttachments: async () => {} }, db: {} }),
}))
vi.mock('../hooks', () => ({
  useTask: () => state.task,
  useAttachments: () => [],
  useCategories: () => [],
  useAccountPrefs: () => [DEFAULT_PREFS, () => {}],
  useDateSettings: () => [DEFAULT_PREFS.dates, () => {}],
  useCompactLayout: () => false,
  useToday: () => todayLocal(),
}))

const { TaskDetailPane } = await import('./TaskDetailPane')

function step(id: string, displayName: string): Step {
  return { id, displayName, isChecked: false, createdDateTime: '2026-01-01T00:00:00Z', checkedDateTime: null }
}

function show(steps: Step[]) {
  state.task = { ...newLocalTask('L1', 'Prepare review'), steps }
  render(
    <FluentProvider theme={webLightTheme}>
      <TaskDetailPane taskId={state.task.id} onClose={() => {}} />
    </FluentProvider>,
  )
  return state.task
}

// The step's field: a read-only box while it holds a web address, a textarea otherwise or while editing.
const stepField = () => screen.getByRole('textbox', { name: 'Step' })

beforeEach(() => {
  repo.updateStep.mockClear()
})
afterEach(cleanup)

describe('steps in the task detail pane', () => {
  it('shows web addresses in a step as links, and tapping the rest of the step edits it', () => {
    show([step('s1', 'Read https://example.com/docs first')])
    const link = screen.getByRole('link', { name: 'https://example.com/docs' })
    expect(link).toHaveAttribute('href', 'https://example.com/docs')
    expect(stepField().tagName).toBe('DIV')

    fireEvent.click(link)
    expect(stepField().tagName).toBe('DIV')

    fireEvent.click(stepField())
    expect(stepField().tagName).toBe('TEXTAREA')
  })

  it('shows the links again when editing is left without a change', () => {
    show([step('s1', 'Read https://example.com/docs first')])
    fireEvent.click(stepField())
    fireEvent.blur(stepField())
    expect(stepField().tagName).toBe('DIV')
    expect(screen.getByRole('link', { name: 'https://example.com/docs' })).toBeInTheDocument()
    expect(repo.updateStep).not.toHaveBeenCalled()
  })

  it('a step without a web address is an editable textarea, with line breaks dropped', () => {
    show([step('s1', 'Milk')])
    const field = stepField()
    expect(field.tagName).toBe('TEXTAREA')
    fireEvent.change(field, { target: { value: 'Oat\nmilk' } })
    expect(stepField()).toHaveValue('Oatmilk')
  })

  it('Enter leaves the step and saves its new name', () => {
    const task = show([step('s1', 'Milk')])
    const field = stepField()
    field.focus()
    fireEvent.change(field, { target: { value: 'Oat milk' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(repo.updateStep).toHaveBeenCalledWith(task.id, 's1', { displayName: 'Oat milk' })
  })
})
