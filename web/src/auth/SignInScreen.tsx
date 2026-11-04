import { Button, Text, Title1, makeStyles, tokens } from '@fluentui/react-components'
import { signIn } from './tokens'

const useStyles = makeStyles({
  root: {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacingVerticalL,
    padding: tokens.spacingHorizontalXL,
    textAlign: 'center',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  tagline: {
    maxWidth: '28rem',
    color: tokens.colorNeutralForeground2,
  },
})

export function SignInScreen() {
  const styles = useStyles()
  return (
    <main className={styles.root}>
      <Title1>Woutist</Title1>
      <Text className={styles.tagline}>
        Your Microsoft To Do lists, anywhere. Sign in with a personal, work or school Microsoft
        account.
      </Text>
      <Button appearance="primary" size="large" onClick={() => void signIn()}>
        Sign in with Microsoft
      </Button>
    </main>
  )
}
