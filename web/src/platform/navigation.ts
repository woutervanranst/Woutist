import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { WoutistNative } from '../native/plugins'
import { isNative } from './native'
import { useServiceWorkerNavigation } from './pwa'

/** Open the task a notification was tapped for: service-worker messages on the web, native intents on Android. */
export function usePlatformNavigation(): void {
  useServiceWorkerNavigation()
  const navigate = useNavigate()
  useEffect(() => {
    if (!isNative) return
    let alive = true
    void WoutistNative.consumeLaunchUrl().then(({ url }) => {
      if (alive && url) navigate(url)
    })
    const handle = WoutistNative.addListener('navigate', ({ url }) => navigate(url))
    return () => {
      alive = false
      void handle.then((h) => h.remove())
    }
  }, [navigate])
}
