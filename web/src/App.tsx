import { FluentProvider, Title1, webLightTheme } from '@fluentui/react-components'

export default function App() {
  return (
    <FluentProvider theme={webLightTheme}>
      <main style={{ padding: 32 }}>
        <Title1>Woutist</Title1>
      </main>
    </FluentProvider>
  )
}
