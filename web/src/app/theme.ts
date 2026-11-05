import {
  type BrandVariants,
  createDarkTheme,
  createLightTheme,
  type Theme,
} from '@fluentui/react-components'
import { useEffect, useState } from 'react'
import type { QuickDateVisual } from '../models/quickDates'
import type { ThemePref } from './prefs'

/** Woutist brand ramp around #186DB6 (the Blue Software blue), darkest (10) to lightest (160). */
const brand: BrandVariants = {
  10: '#05182b',
  20: '#07223b',
  30: '#0a2d4d',
  40: '#0c385f',
  50: '#0f4372',
  60: '#114f85',
  70: '#145d9c',
  80: '#186db6',
  90: '#2f7cbd',
  100: '#468ac5',
  110: '#609acd',
  120: '#79aad5',
  130: '#92badd',
  140: '#accae5',
  150: '#c5dbed',
  160: '#dfebf5',
}

/** Quick-date icon colors, light and dark. */
const QUICK_DATE_COLORS: Record<QuickDateVisual, [light: string, dark: string]> = {
  today: ['#107c10', '#54b054'],
  tomorrow: ['#ca5010', '#e9835e'],
  dayAfter: ['#038387', '#4bb4b7'],
  weekend: ['#0f6cbd', '#62abf5'],
  nextWeek: ['#8764b8', '#b69cdb'],
  inWeek: ['#c239b3', '#da7ed0'],
  days: ['#986f0b', '#d9b75e'],
  weeks: ['#4f6bed', '#93a4f4'],
  weekday: ['#0b6a0b', '#6bb76b'],
  none: ['#616161', '#adadad'],
}
const quickDateToken = (visual: QuickDateVisual) => `woutistQuickDate-${visual}`

/** CSS color of a quick date's icon. FluentProvider turns every theme key into a CSS variable. */
export const quickDateColor = (visual: QuickDateVisual) =>
  `var(--${quickDateToken(visual)}, ${QUICK_DATE_COLORS[visual][0]})`

const quickDateTokens = (dark: boolean) =>
  Object.fromEntries(
    (Object.keys(QUICK_DATE_COLORS) as QuickDateVisual[]).map((v) => [quickDateToken(v), QUICK_DATE_COLORS[v][dark ? 1 : 0]]),
  )

export const lightTheme: Theme = { ...createLightTheme(brand), ...quickDateTokens(false) }
export const darkTheme: Theme = {
  ...createDarkTheme(brand),
  colorBrandForeground1: brand[120],
  colorBrandForeground2: brand[130],
  ...quickDateTokens(true),
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false,
  )
  useEffect(() => {
    if (!window.matchMedia) return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export function useResolvedTheme(pref: ThemePref): { theme: Theme; dark: boolean } {
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const dark = pref === 'dark' || (pref === 'system' && systemDark)
  return { theme: dark ? darkTheme : lightTheme, dark }
}
