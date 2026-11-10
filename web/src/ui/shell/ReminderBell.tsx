import {
  Button,
  CounterBadge,
  Link,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Text,
  Toast,
  ToastTitle,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
  useToastController,
} from '@fluentui/react-components'
import { AlertOnRegular } from '@fluentui/react-icons/svg/alert-on'
import { AlertRegular } from '@fluentui/react-icons/svg/alert'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useServices } from '../../app/AppServices'
import { formatTimeOfDay } from '../../models/dateReminder'
import {
  type DismissedReminders,
  describeSnooze,
  dueReminders,
  formatAgo,
  pruneDismissed,
  snoozeChanges,
  snoozeOptions,
} from '../../models/dueReminders'
import { instantToZonedWall, todayLocal, userTimeZone, zonedWallToInstant } from '../../models/time'
import type { Task } from '../../models/todo'
import { useAccountPrefs, useLists, useNow } from '../hooks'

const useStyles = makeStyles({
  button: { color: tokens.colorNeutralForegroundOnBrand, minWidth: '32px', flexShrink: 0, position: 'relative' },
  badge: { position: 'absolute', top: '1px', right: '-2px', pointerEvents: 'none' },
  surface: { width: '380px', maxWidth: 'calc(100vw - 16px)', padding: 0 },
  head: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL} ${tokens.spacingVerticalXS}`,
  },
  list: { maxHeight: '380px', overflowY: 'auto', padding: `0 ${tokens.spacingHorizontalS} ${tokens.spacingVerticalS}` },
  row: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    ':not(:first-child)': { borderTop: `1px solid ${tokens.colorNeutralStroke2}` },
  },
  rowTop: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: tokens.spacingHorizontalM },
  title: { fontWeight: tokens.fontWeightSemibold, textAlign: 'left', minWidth: 0, overflowWrap: 'anywhere' },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  ago: { flexShrink: 0, whiteSpace: 'nowrap' },
  meta: { margin: `2px 0 ${tokens.spacingVerticalS}` },
  actions: { display: 'flex', gap: tokens.spacingHorizontalXS, alignItems: 'center', flexWrap: 'wrap' },
  picker: {
    marginTop: tokens.spacingVerticalS,
    display: 'flex',
    gap: tokens.spacingHorizontalXS,
    alignItems: 'center',
  },
  dateTime: {
    flex: 1,
    minWidth: 0,
    height: '28px',
    fontFamily: 'inherit',
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: '0 6px',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: tokens.spacingVerticalXS,
    padding: `${tokens.spacingVerticalXL} ${tokens.spacingHorizontalL}`,
    color: tokens.colorNeutralForeground3,
  },
})

/** `YYYY-MM-DDTHH:mm` for an `<input type="datetime-local">`, in the user's zone. */
const toInputValue = (instant: Date, tz: string) => instantToZonedWall(instant, tz).slice(0, 16)

/**
 * The header's reminder bell (computers only: a phone's push notification is the reminder). It counts
 * the reminders that have come due and lists them in a popover, where each can be snoozed (the
 * reminder moves, and the new time is saved to Microsoft To Do) or dismissed (on this device).
 */
export function ReminderBell() {
  const styles = useStyles()
  const { db } = useServices()
  const [prefs, updatePrefs] = useAccountPrefs()
  const now = useNow(15_000)
  const [open, setOpen] = useState(false)
  const candidates = useLiveQuery(
    () => db.tasks.filter((t) => t.isReminderOn && !t.completed && t.reminderAt !== null).toArray(),
    [db],
  )
  const due = useMemo(
    () => dueReminders(candidates ?? [], prefs.dismissedReminders, now),
    [candidates, prefs.dismissedReminders, now],
  )

  const dismiss = (tasks: Task[]) =>
    updatePrefs((p) => {
      const dismissed: DismissedReminders = candidates
        ? pruneDismissed(p.dismissedReminders, candidates)
        : p.dismissedReminders
      return {
        ...p,
        dismissedReminders: { ...dismissed, ...Object.fromEntries(tasks.map((t) => [t.id, t.reminderAt!])) },
      }
    })

  const count = due.length
  const label = count > 0 ? `Reminders, ${count} due` : 'Reminders'

  return (
    <Popover open={open} onOpenChange={(_, data) => setOpen(data.open)} positioning="below" withArrow>
      <Tooltip content="Reminders" relationship="description">
        <PopoverTrigger disableButtonEnhancement>
          <Button
            appearance="transparent"
            className={styles.button}
            aria-label={label}
            icon={count > 0 ? <AlertOnRegular /> : <AlertRegular />}
          >
            {count > 0 && (
              <CounterBadge className={styles.badge} color="danger" size="small" count={count} overflowCount={9} />
            )}
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverSurface className={styles.surface} aria-label="Reminders">
        <div className={styles.head}>
          <Text weight="semibold" size={400}>
            Reminders
          </Text>
          {count > 1 && (
            <Link as="button" onClick={() => dismiss(due)}>
              Dismiss all
            </Link>
          )}
        </div>
        {count === 0 ? (
          <div className={styles.empty}>
            <AlertRegular fontSize={28} />
            <Text>No reminders right now</Text>
          </div>
        ) : (
          <div className={styles.list}>
            {due.map((task) => (
              <ReminderRow
                key={task.id}
                task={task}
                now={now}
                onDismiss={() => dismiss([task])}
                onOpened={() => setOpen(false)}
              />
            ))}
          </div>
        )}
      </PopoverSurface>
    </Popover>
  )
}

function ReminderRow({
  task,
  now,
  onDismiss,
  onOpened,
}: {
  task: Task
  now: Date
  onDismiss: () => void
  onOpened: () => void
}) {
  const styles = useStyles()
  const { repo } = useServices()
  const [prefs] = useAccountPrefs()
  const lists = useLists()
  const navigate = useNavigate()
  const { dispatchToast } = useToastController('app')
  const tz = userTimeZone()
  const [picking, setPicking] = useState(false)
  const [custom, setCustom] = useState('')
  const listName = lists?.find((l) => l.id === task.listId)?.displayName
  const options = snoozeOptions(prefs.dates, now, tz)

  const say = (text: string, intent: 'success' | 'error' = 'success') =>
    dispatchToast(
      <Toast>
        <ToastTitle>{text}</ToastTitle>
      </Toast>,
      { intent },
    )

  const snooze = async (at: Date) => {
    try {
      await repo.updateTask(task.id, snoozeChanges(at))
      say(describeSnooze(at, todayLocal(now, tz), tz))
    } catch {
      say("Couldn't snooze this reminder", 'error')
    }
  }

  const customAt = custom ? zonedWallToInstant(`${custom}:00`, tz) : null
  const customValid = customAt !== null && !Number.isNaN(customAt.getTime()) && customAt.getTime() > now.getTime()

  return (
    <div className={styles.row}>
      <div className={styles.rowTop}>
        <Link
          as="button"
          className={styles.title}
          onClick={() => {
            onOpened()
            navigate({ pathname: `/lists/${encodeURIComponent(task.listId)}`, search: new URLSearchParams({ task: task.id }).toString() })
          }}
        >
          {task.title}
        </Link>
        <span className={mergeClasses(styles.muted, styles.ago)}>{formatAgo(task.reminderAt!, now)}</span>
      </div>
      {listName && <div className={mergeClasses(styles.muted, styles.meta)}>{listName}</div>}
      <div className={styles.actions}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <Button size="small">Snooze</Button>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {options.map((o) => (
                <MenuItem
                  key={o.id}
                  secondaryContent={o.time ? formatTimeOfDay(o.time) : undefined}
                  onClick={() => void snooze(o.at)}
                >
                  {o.label}
                </MenuItem>
              ))}
              <MenuDivider />
              <MenuItem
                onClick={() => {
                  setCustom(toInputValue(new Date(now.getTime() + 60 * 60_000), tz))
                  setPicking(true)
                }}
              >
                Pick a time…
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Button size="small" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      {picking && (
        <div className={styles.picker}>
          <input
            type="datetime-local"
            className={styles.dateTime}
            aria-label="Snooze until"
            value={custom}
            min={toInputValue(now, tz)}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customValid) void snooze(customAt)
            }}
          />
          <Button
            appearance="primary"
            size="small"
            disabled={!customValid}
            onClick={() => customAt && void snooze(customAt)}
          >
            Snooze
          </Button>
        </div>
      )}
    </div>
  )
}
