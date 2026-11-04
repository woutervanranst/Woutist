import {
  type BrandVariants,
  createDarkTheme,
  createLightTheme,
  type Theme,
} from '@fluentui/react-components'
import { useEffect, useState } from 'react'
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

export const lightTheme: Theme = createLightTheme(brand)
export const darkTheme: Theme = {
  ...createDarkTheme(brand),
  colorBrandForeground1: brand[120],
  colorBrandForeground2: brand[130],
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
