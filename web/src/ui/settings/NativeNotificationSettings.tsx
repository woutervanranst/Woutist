import { Body1, Button, Caption1, Divider, Subtitle2, makeStyles, tokens } from '@fluentui/react-components'
import { useState } from 'react'
import { type NativeSettingsTarget, type NativeStatus, WoutistNative } from '../../native/plugins'
import { fixNativeSetting } from '../../native/reminderHealth'
import { useNativeStatus } from '../../native/useNativeStatus'
import { PAST_REMINDERS_HINT, pastRemindersMessage } from './pastRemindersMessage'

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, margin: `${tokens.spacingVerticalL} 0` },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: tokens.spacingHorizontalM },
  label: { display: 'flex', flexDirection: 'column' },
})

interface Row {
  key: keyof NativeStatus
  title: string
  on: string
  off: string
  action: string
  target: NativeSettingsTarget
}

const ROWS: Row[] = [
  { key: 'notifications', title: 'Notifications', on: 'Allowed', off: 'Off: reminders stay silent', action: 'Allow notifications', target: 'notifications' },
  { key: 'exactAlarms', title: 'Exact reminder times', on: 'Allowed', off: 'Off: reminders may come a few minutes late', action: 'Allow exact reminders', target: 'exactAlarms' },
  { key: 'batteryUnrestricted', title: 'Battery', on: 'Not restricted', off: 'Restricted: the phone may hold back reminders', action: "Don't restrict battery (OnePlus)", target: 'battery' },
]

/** Reminder settings of the Android app: what the phone allows, with a shortcut to fix each. */
export function NativeNotificationSettings() {
  const styles = useStyles()
  const [status, refresh] = useNativeStatus()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function showPast() {
    setBusy(true)
    try {
      setMessage(pastRemindersMessage((await WoutistNative.showPastReminders()).count))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn't show the reminders.")
    } finally {
      setBusy(false)
    }
  }

  async function fix(row: Row) {
    if ((await fixNativeSetting(row.target)) === 'granted') refresh()
  }

  return (
    <>
      <Divider />
      <div className={styles.section}>
        <Subtitle2>Reminders on this phone</Subtitle2>
        {ROWS.map((row) => {
          const ok = status?.[row.key] ?? false
          return (
            <div key={row.key} className={styles.row}>
              <div className={styles.label}>
                <Body1>{row.title}</Body1>
                <Caption1>{status ? (ok ? row.on : row.off) : '…'}</Caption1>
              </div>
              <Button size="small" disabled={!status || ok} onClick={() => void fix(row)}>
                {row.action}
              </Button>
            </div>
          )
        })}
        <div className={styles.label}>
          <Body1>Past reminders</Body1>
          <Caption1>{message ?? PAST_REMINDERS_HINT}</Caption1>
        </div>
        <Button size="small" disabled={busy} onClick={() => void showPast()}>
          Show past reminders again
        </Button>
        <Caption1>
          Woutist schedules your reminders on this phone. If the official Microsoft To Do app is also
          installed, it may notify you too.
        </Caption1>
      </div>
    </>
  )
}
