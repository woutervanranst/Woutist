import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}),
  create: vi.fn(async () => {}),
  edit: vi.fn(async () => {}),
  usage: vi.fn(async () => 0),
  remove: vi.fn(async () => 0),
}))
const state = vi.hoisted(() => ({
  categories: [] as { id: string; displayName: string; color: string }[],
}))

vi.mock('../../app/AppServices', () => ({ useServices: () => ({ categories: service }) }))
vi.mock('../hooks', () => ({ useCategories: () => state.categories }))

const { CategorySettings } = await import('./CategorySettings')

const renderIt = () =>
  render(
    <FluentProvider theme={webLightTheme}>
      <CategorySettings />
    </FluentProvider>,
  )

const RED = { id: 'C1', displayName: 'Red category', color: 'preset0' }

afterEach(cleanup)
beforeEach(() => {
  state.categories = [RED, { id: 'C2', displayName: 'Blue', color: 'preset7' }]
  for (const fn of Object.values(service)) fn.mockClear()
  service.usage.mockResolvedValue(0)
})

describe('CategorySettings', () => {
  it('lists the categories and reloads them when opened', async () => {
    renderIt()
    expect(screen.getByText('Red category')).toBeInTheDocument()
    expect(screen.getByText('Blue')).toBeInTheDocument()
    await waitFor(() => expect(service.refresh).toHaveBeenCalled())
  })

  it('says so when there are none', () => {
    state.categories = []
    renderIt()
    expect(screen.getByText('No categories yet.')).toBeInTheDocument()
  })

  it('creates a category with a name and a color', async () => {
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: 'New category' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Errands' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'preset7' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(service.create).toHaveBeenCalledWith('Errands', 'preset7'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps Save disabled until something changed', async () => {
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Red category' }))
    const dialog = await screen.findByRole('dialog')
    const save = within(dialog).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Crimson' } })
    expect(save).toBeEnabled()
  })

  it('edits a category', async () => {
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Red category' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Crimson' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'preset15' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(service.edit).toHaveBeenCalledWith(RED, { name: 'Crimson', color: 'preset15' }))
  })

  it('shows the error from a failed save and keeps the dialog open', async () => {
    service.create.mockRejectedValueOnce(new Error('A category named "Blue" already exists'))
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: 'New category' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Blue' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText(/already exists/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('asks before deleting and says how many tasks lose the category', async () => {
    service.usage.mockResolvedValue(3)
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Red category' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/removed from 3 tasks/)).toBeInTheDocument()
    expect(service.remove).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(service.remove).toHaveBeenCalledWith(RED))
  })

  it('does not delete when cancelled', async () => {
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Blue' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/No tasks use it/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(service.remove).not.toHaveBeenCalled()
  })

  it('shows why a delete failed', async () => {
    service.remove.mockRejectedValueOnce(new Error('Access is denied'))
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Blue' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Access is denied')).toBeInTheDocument()
  })
})
