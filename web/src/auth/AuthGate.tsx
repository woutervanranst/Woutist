import { InteractionStatus } from '@azure/msal-browser'
import { useIsAuthenticated, useMsal } from '@azure/msal-react'
import { Spinner } from '@fluentui/react-components'
import type { ReactNode } from 'react'
import { SignInScreen } from './SignInScreen'

/** Renders children only for a signed-in user; otherwise the sign-in screen. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { inProgress } = useMsal()
  const isAuthenticated = useIsAuthenticated()

  if (isAuthenticated) return <>{children}</>
  if (inProgress !== InteractionStatus.None) {
    return <Spinner style={{ minHeight: '100dvh' }} label="Signing in…" />
  }
  return <SignInScreen />
}
