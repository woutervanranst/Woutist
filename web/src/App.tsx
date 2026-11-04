import { FluentProvider } from '@fluentui/react-components'
import { BrowserRouter } from 'react-router'
import { AppServicesProvider } from './app/AppServices'
import { useResolvedTheme } from './app/theme'
import { AuthGate } from './auth/AuthGate'
import { useAccountPrefs } from './ui/hooks'
import { AppShell } from './ui/shell/AppShell'

const fill = { height: '100dvh' }

/** Theme chosen in Settings (per account). */
function AccountApp() {
  const [prefs] = useAccountPrefs()
  const { theme } = useResolvedTheme(prefs.theme)
  return (
    <FluentProvider theme={theme} style={fill}>
      <AppShell />
    </FluentProvider>
  )
}

export default function App() {
  const { theme } = useResolvedTheme('system')
  return (
    <FluentProvider theme={theme} style={fill}>
      <BrowserRouter>
        <AuthGate>
          <AppServicesProvider>
            <AccountApp />
          </AppServicesProvider>
        </AuthGate>
      </BrowserRouter>
    </FluentProvider>
  )
}
