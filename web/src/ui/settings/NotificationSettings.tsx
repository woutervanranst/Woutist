import { Button, Caption1, Divider, Subtitle2, Switch, makeStyles, tokens } from '@fluentui/react-components'
import { useState, useSyncExternalStore } from 'react'
import { useServices } from '../../app/AppServices'
import { useInstallPrompt } from '../../platform/pwa'
import { isNative } from '../../platform/native'
import { PushController } from '../../services/push/pushController'

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, margin: `${tokens.spacingVerticalL} 0` },
})

export function NotificationSettings() {
  // The Android app has its own notification settings (native reminders).
  return isNative ? null : <WebNotificationSettings />
}

function WebNotificationSettings() {
  const styles = useStyles()
  const { push } = useServices()
  const install = useInstallPrompt()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state = useSyncExternalStore(
    push?.subscribe ?? (() => () => {}),
    () => push?.state() ?? (PushController.isSupported() ? 'off' : 'unsupported'),
  )

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Divider />
      <div className={styles.section}>
        <Subtitle2>Reminders on this device</Subtitle2>
        {!push ? (
          <Caption1>Push reminders aren't configured for this build.</Caption1>
        ) : state === 'unsupported' ? (
          <Caption1>This browser doesn't support push notifications.</Caption1>
        ) : (
          <>
            <Switch
              label="Send me reminder notifications"
              checked={state === 'on'}
              disabled={busy || state === 'denied'}
              onChange={(_, d) => void run(() => (d.checked ? push.enable() : push.disable()))}
            />
            {state === 'denied' && (
              <Caption1>Notifications are blocked for this site. Allow them in your browser settings.</Caption1>
            )}
            <Caption1>
              Woutist only sends the time and id of upcoming reminders to its reminder service; task
              titles stay on your devices. If the official To Do app is also installed, you may get two
              notifications.
            </Caption1>
            <Button
              size="small"
              appearance="secondary"
              disabled={busy}
              onClick={() => void run(() => push.removeServerData())}
            >
              Remove my data from the reminder service
            </Button>
          </>
        )}
        {error && <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>{error}</Caption1>}
        {install && (
          <Button appearance="primary" onClick={() => void install()}>
            Install Woutist as an app
          </Button>
        )}
      </div>
    </>
  )
}
