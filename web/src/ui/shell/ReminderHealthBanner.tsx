import { Button, MessageBar, MessageBarActions, MessageBarBody } from '@fluentui/react-components'
import { useState } from 'react'
import { bannerDismissed, dismissBanner, fixNativeSetting, reminderIssue } from '../../native/reminderHealth'
import { useNativeStatus } from '../../native/useNativeStatus'

/**
 * Android app: tells the user when the phone would hold back their reminders (notifications off,
 * no exact alarms, battery restricted) and opens the screen that fixes it. Shown only while the
 * account has upcoming reminders; "Not now" hides it for a week.
 */
export function ReminderHealthBanner({ accountKey, active }: { accountKey: string; active: boolean }) {
  const [status, refresh] = useNativeStatus()
  const [dismissed, setDismissed] = useState(() => bannerDismissed(accountKey))
  const issue = reminderIssue(status)
  if (!active || dismissed || !issue) return null
  return (
    <MessageBar intent="warning" layout="multiline">
      <MessageBarBody>{issue.message}</MessageBarBody>
      <MessageBarActions>
        <Button
          size="small"
          appearance="primary"
          onClick={() => void fixNativeSetting(issue.target).then((r) => r === 'granted' && refresh())}
        >
          {issue.action}
        </Button>
        <Button
          size="small"
          onClick={() => {
            dismissBanner(accountKey)
            setDismissed(true)
          }}
        >
          Not now
        </Button>
      </MessageBarActions>
    </MessageBar>
  )
}
