import { useCallback, useEffect, useState } from 'react'
import { type NativeStatus, WoutistNative } from './plugins'

/** What the phone allows for reminders; re-read when the app comes back (e.g. from the system settings). */
export function useNativeStatus(): [NativeStatus | null, () => void] {
  const [status, setStatus] = useState<NativeStatus | null>(null)
  const refresh = useCallback(() => {
    WoutistNative.getStatus()
      .then(setStatus)
      .catch((error) => console.warn('Reading the reminder settings failed', error))
  }, [])
  useEffect(() => {
    refresh()
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])
  return [status, refresh]
}
