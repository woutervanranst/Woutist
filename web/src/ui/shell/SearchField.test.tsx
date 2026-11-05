import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEARCH_DEBOUNCE_MS, SearchField } from './SearchField'

/** Renders the field at `path` and records every location it navigates to. */
function renderAt(path: string) {
  const visited: string[] = []
  function Probe() {
    const loc = useLocation()
    useEffect(() => {
      visited.push(loc.pathname + loc.search)
    }, [loc])
    return null
  }
  function Field() {
    const ref = useRef<HTMLInputElement>(null)
    return <SearchField inputRef={ref} />
  }
  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={[path]}>
        <Field />
        <Probe />
      </MemoryRouter>
    </FluentProvider>,
  )
  const input = screen.getByRole('searchbox', { name: 'Search tasks' })
  return {
    visited,
    here: () => visited.at(-1),
    type: (value: string) => fireEvent.change(input, { target: { value } }),
    enter: () => fireEvent.keyDown(input, { key: 'Enter' }),
    wait: (ms: number) => act(() => void vi.advanceTimersByTime(ms)),
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('SearchField', () => {
  it('searches once typing pauses, not on every keystroke', () => {
    const f = renderAt('/lists/L1')
    f.type('m')
    f.type('mi')
    f.wait(SEARCH_DEBOUNCE_MS - 1)
    f.type('mil')
    f.wait(SEARCH_DEBOUNCE_MS - 1)
    expect(f.here()).toBe('/lists/L1')
    f.wait(1)
    expect(f.visited).toEqual(['/lists/L1', '/search?q=mil'])
  })

  it('updates the results while on the search page', () => {
    const f = renderAt('/lists/L1')
    f.type('milk')
    f.wait(SEARCH_DEBOUNCE_MS)
    f.type('milk oat')
    f.wait(SEARCH_DEBOUNCE_MS)
    expect(f.here()).toBe('/search?q=milk%20oat')
  })

  it('searches at once on Enter', () => {
    const f = renderAt('/lists/L1')
    f.type('bread')
    f.enter()
    expect(f.here()).toBe('/search?q=bread')
    f.wait(SEARCH_DEBOUNCE_MS)
    expect(f.visited).toEqual(['/lists/L1', '/search?q=bread'])
  })

  it('goes back to the previous list at once when cleared, dropping a pending search', () => {
    const f = renderAt('/lists/L1')
    f.type('bread')
    f.wait(SEARCH_DEBOUNCE_MS)
    f.type('bread and')
    f.type('')
    expect(f.here()).toBe('/lists/L1')
    f.wait(SEARCH_DEBOUNCE_MS)
    expect(f.here()).toBe('/lists/L1')
  })

  it('stays put when cleared before the search started', () => {
    const f = renderAt('/important')
    f.type('b')
    f.type('  ')
    f.wait(SEARCH_DEBOUNCE_MS)
    expect(f.visited).toEqual(['/important'])
  })
})
