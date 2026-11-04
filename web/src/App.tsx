import { useMsal } from '@azure/msal-react'
import { Button, FluentProvider, Text, Title1, webLightTheme } from '@fluentui/react-components'
import { AuthGate } from './auth/AuthGate'
import { signOut } from './auth/tokens'

function Home() {
  const { accounts } = useMsal()
  return (
    <main style={{ padding: 32, display: 'grid', gap: 12 }}>
      <Title1>Woutist</Title1>
      <Text>Signed in as {accounts[0]?.username}</Text>
      <div>
        <Button onClick={() => void signOut()}>Sign out</Button>
      </div>
    </main>
  )
}

export default function App() {
  return (
    <FluentProvider theme={webLightTheme}>
      <AuthGate>
        <Home />
      </AuthGate>
    </FluentProvider>
  )
}
