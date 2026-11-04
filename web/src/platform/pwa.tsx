import { Button, MessageBar, MessageBarActions, MessageBarBody } from '@fluentui/react-components'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useRegisterSW } from 'virtual:pwa-register/react'

/** "New version available" bar; the new service worker only takes over when the user agrees. */
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Check for a new version every hour while the app is open.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000)
    },
  })
  if (!needRefresh) return null
  return (
    <div style={{ position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 1000, maxWidth: 560, margin: '0 auto' }}>
      <MessageBar intent="info">
        <MessageBarBody>A new version of Woutist is available.</MessageBarBody>
        <MessageBarActions>
          <Button appearance="primary" size="small" onClick={() => void updateServiceWorker(true)}>
            Reload
          </Button>
          <Button size="small" onClick={() => setNeedRefresh(false)}>
            Later
          </Button>
        </MessageBarActions>
      </MessageBar>
    </div>
  )
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const installListeners = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    for (const l of installListeners) l()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    for (const l of installListeners) l()
  })
}

/** Returns an install function when the browser offers installing the PWA, else null. */
export function useInstallPrompt(): (() => Promise<void>) | null {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    installListeners.add(l)
    return () => {
      installListeners.delete(l)
    }
  }, [])
  if (!deferredPrompt) return null
  return async () => {
    const p = deferredPrompt
    deferredPrompt = null
    await p?.prompt()
  }
}

/** Follow navigation requests from the service worker (notification clicks). */
export function useServiceWorkerNavigation() {
  const navigate = useNavigate()
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'navigate' && typeof event.data.url === 'string') navigate(event.data.url)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate])
}
