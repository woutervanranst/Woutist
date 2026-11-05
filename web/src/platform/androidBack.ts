import { App } from '@capacitor/app'
import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { isNative } from './native'

export type BackAction = 'closeDialog' | 'closeTask' | 'back' | 'exit'

/** What Android's Back should do: close the innermost thing first, leave the app last. */
export function backAction(state: { hasOpenDialog: boolean; hasTaskParam: boolean; canGoBack: boolean }): BackAction {
  if (state.hasOpenDialog) return 'closeDialog'
  if (state.hasTaskParam) return 'closeTask'
  if (state.canGoBack) return 'back'
  return 'exit'
}

/** Mounts the Back handler. It must sit above the sign-in gate: without any listener, Capacitor's App
 *  plugin swallows Back and the app could never be left from the sign-in screen. */
export function AndroidBackHandler(): null {
  useAndroidBack()
  return null
}

/** Handle the hardware/gesture Back button in the Android app (no-op on the web). */
export function useAndroidBack(): void {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const latest = useRef({ navigate, params, setParams })
  latest.current = { navigate, params, setParams }

  useEffect(() => {
    if (!isNative) return
    const handle = App.addListener('backButton', ({ canGoBack }) => {
      const { navigate, params, setParams } = latest.current
      const action = backAction({
        hasOpenDialog: document.querySelector('[role="dialog"]') !== null,
        hasTaskParam: params.has('task'),
        canGoBack,
      })
      switch (action) {
        case 'closeDialog': {
          const target = document.activeElement ?? document.body
          target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
          break
        }
        case 'closeTask':
          setParams(
            (prev) => {
              const next = new URLSearchParams(prev)
              next.delete('task')
              return next
            },
            { replace: true },
          )
          break
        case 'back':
          void navigate(-1)
          break
        case 'exit':
          void App.exitApp()
          break
      }
    })
    return () => {
      void handle.then((h) => h.remove())
    }
  }, [])
}
