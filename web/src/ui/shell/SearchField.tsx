import { makeStyles, mergeClasses, SearchBox, tokens } from '@fluentui/react-components'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'

const useStyles = makeStyles({
  // Fluent collapses the clear button once the box loses focus; keep it there while there is text,
  // so clearing a search takes one click rather than a click to focus first.
  clearVisible: {
    height: 'auto',
    width: 'auto',
    overflow: 'visible',
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalM,
  },
})

/** How long typing must pause before the results update. */
export const SEARCH_DEBOUNCE_MS = 250

/**
 * The header search box. It shows each keystroke at once, but searches only once typing pauses:
 * a search scans every task, completed ones included.
 */
export function SearchField({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const styles = useStyles()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const [value, setValue] = useState(params.get('q') ?? '')
  // Where clearing the box goes back to.
  const lastPath = useRef('/')
  const here = useRef(pathname)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    here.current = pathname
  })
  useEffect(() => () => clearTimeout(timer.current), [])

  const search = (query: string) => {
    clearTimeout(timer.current)
    const onSearch = here.current.startsWith('/search')
    if (!onSearch) lastPath.current = here.current
    navigate(`/search?q=${encodeURIComponent(query)}`, { replace: onSearch })
  }

  return (
    <SearchBox
      ref={inputRef}
      size="small"
      appearance="filled-lighter"
      placeholder="Search"
      aria-label="Search tasks"
      value={value}
      contentAfter={{ className: mergeClasses(value !== '' && styles.clearVisible) }}
      style={{ width: '100%', maxWidth: 'none', minWidth: 0 }}
      onChange={(_, d) => {
        setValue(d.value)
        clearTimeout(timer.current)
        if (d.value.trim()) timer.current = setTimeout(() => search(d.value), SEARCH_DEBOUNCE_MS)
        else if (here.current.startsWith('/search')) navigate(lastPath.current)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && value.trim()) search(value)
      }}
    />
  )
}
