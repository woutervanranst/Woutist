import {
  type BrandVariants,
  createDarkTheme,
  createLightTheme,
  type Theme,
} from '@fluentui/react-components'
import { useEffect, useState } from 'react'
import type { ThemePref } from './prefs'

/** Woutist brand ramp (teal), from darkest (10) to lightest (160). */
const brand: BrandVariants = {
  10: '#021414',
  20: '#052222',
  30: '#073030',
  40: '#093e3e',
  50: '#0b4c4c',
  60: '#0c5a5a',
  70: '#0d6868',
  80: '#0e7c7b',
  90: '#1f8a89',
  100: '#359897',
  110: '#4ca6a5',
  120: '#64b4b3',
  130: '#7dc2c1',
  140: '#97d0cf',
  150: '#b2dedd',
  160: '#cdebea',
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
