import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS } from '../../app/prefs'
import { todayLocal } from '../../models/time'
import { newLocalTask, type Task, type TodoList } from '../../models/todo'
import type { ViewRef } from '../../models/views'

const state = vi.hoisted(() => ({ tasks: [] as Task[] }))

vi.mock('../../app/AppServices', () => ({
  useServices: () => ({ accountKey: 'list-test', repo: {}, db: {} }),
}))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => true }))
vi.mock('../hooks', () => {
  const lists: TodoList[] = [
    { id: 'L1', displayName: 'Tasks', wellknownListName: 'defaultList', isOwner: true, isShared: false, sortIndex: 0 },
  ]
  return {
    useAllTasks: () => state.tasks,
    useLists: () => lists,
    useCategories: () => [],
    usePendingTaskIds: () => new Set(),
    useAccountPrefs: () => [DEFAULT_PREFS, () => {}],
    useDateSettings: () => [DEFAULT_PREFS.dates, () => {}],
    useSelectedTask: () => [null, () => {}],
    useCompactLayout: () => false,
    useToday: () => todayLocal(),
    useSyncStatus: () => ({ state: 'idle', lastSyncAt: null, pendingChanges: 0, error: null }),
  }
})

const { RENDER_STEP, TaskListView } = await import('./TaskListView')

const make = (count: number, title: string, extra: Partial<Task> = {}) =>
  Array.from({ length: count }, (_, i) => ({ ...newLocalTask('L1', `${title} ${i}`), ...extra }))
const done = { completed: 1, status: 'completed', completedDate: '2026-01-01' } as const

function show(view: ViewRef, tasks: Task[]) {
  state.tasks = tasks
  const ui = (v: ViewRef) => (
    <FluentProvider theme={webLightTheme}>
      <TaskListView view={v} />
    </FluentProvider>
  )
  const { container, rerender } = render(ui(view))
  return {
    rows: () => container.querySelectorAll('[aria-pressed]').length,
    more: () => screen.queryByRole('button', { name: /^Show more/ }),
    rerender: (v: ViewRef) => rerender(ui(v)),
  }
}

afterEach(cleanup)

describe('TaskListView with many tasks', () => {
  it('renders search results in batches, open ones first, with full counts', () => {
    const v = show({ kind: 'search', query: 'milk' }, [...make(30, 'milk'), ...make(RENDER_STEP + 20, 'milk', done)])
    expect(v.rows()).toBe(RENDER_STEP)
    expect(screen.getByRole('button', { name: `Completed ${RENDER_STEP + 20}` })).toBeInTheDocument()
    expect(v.more()).toHaveTextContent('50 left')

    fireEvent.click(v.more()!)
    expect(v.rows()).toBe(RENDER_STEP + 50)
    expect(v.more()).toBeNull()
  })

  it('shows the completed section only once all open tasks are shown', () => {
    const v = show({ kind: 'list', listId: 'L1' }, [...make(RENDER_STEP + 5, 'open'), ...make(3, 'old', done)])
    expect(v.rows()).toBe(RENDER_STEP)
    expect(screen.queryByRole('button', { name: /^Completed/ })).toBeNull()

    fireEvent.click(v.more()!)
    // Completed tasks in a list are collapsed by default.
    expect(v.rows()).toBe(RENDER_STEP + 5)
    expect(screen.getByRole('button', { name: 'Completed 3' })).toBeInTheDocument()
    expect(v.more()).toBeNull()
  })

  it('starts over with one batch for a new search', () => {
    const tasks = [...make(RENDER_STEP + 10, 'milk', done), ...make(RENDER_STEP + 10, 'bread', done)]
    const v = show({ kind: 'search', query: 'milk' }, tasks)
    fireEvent.click(v.more()!)
    expect(v.rows()).toBe(RENDER_STEP + 10)
    v.rerender({ kind: 'search', query: 'bread' })
    expect(v.rows()).toBe(RENDER_STEP)
  })

  it('keeps the full count on a planned group that is cut short', () => {
    const v = show({ kind: 'smart', id: 'planned' }, make(RENDER_STEP + 1, 'due', { dueDate: todayLocal() }))
    expect(v.rows()).toBe(RENDER_STEP)
    expect(screen.getByText(`(${RENDER_STEP + 1})`)).toBeInTheDocument()
  })
})
