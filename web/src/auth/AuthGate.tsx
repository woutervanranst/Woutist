import { Spinner } from '@fluentui/react-components'
import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { SignInScreen } from './SignInScreen'

/** Renders children only for a signed-in user; otherwise the sign-in screen. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { account, busy } = useAuth()
  if (account) return <>{children}</>
  if (busy) return <Spinner style={{ minHeight: '100dvh' }} label="Signing in…" />
  return <SignInScreen />
}
