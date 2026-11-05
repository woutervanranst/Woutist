import {
  Button,
  Caption1,
  Checkbox,
  Field,
  Input,
  Radio,
  RadioGroup,
  Select,
  Subtitle2,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import { AddRegular } from '@fluentui/react-icons/svg/add'
import { ChevronDownRegular } from '@fluentui/react-icons/svg/chevron-down'
import { ChevronUpRegular } from '@fluentui/react-icons/svg/chevron-up'
import { DismissRegular } from '@fluentui/react-icons/svg/dismiss'
import { useState } from 'react'
import { formatFullDate, formatTimeOfDay } from '../../models/dateReminder'
import {
  type CustomQuickDate,
  MAX_CUSTOM_AMOUNT,
  MAX_QUICK_DATES,
  MAX_REMINDER_TIMES,
  addCustomQuickDate,
  addReminderTime,
  customQuickDateDef,
  isBuiltIn,
  isTime,
  moveQuickDate,
  quickDateDef,
  removeQuickDate,
  removeReminderTime,
  toggleQuickDate,
} from '../../models/quickDates'
import { todayLocal } from '../../models/time'
import { QuickDateIcon } from '../dates/QuickDateIcon'
import { useDateSettings } from '../hooks'

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, margin: `${tokens.spacingVerticalL} 0` },
  group: { display: 'flex', flexDirection: 'column', gap: '2px' },
  label: { fontWeight: tokens.fontWeightSemibold },
  caption: { color: tokens.colorNeutralForeground3 },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minHeight: '34px',
    padding: '0 2px 0 0',
    borderRadius: tokens.borderRadiusMedium,
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  rowLabel: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  off: { color: tokens.colorNeutralForeground4 },
  rule: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, whiteSpace: 'nowrap' },
  hidden: { visibility: 'hidden' },
  add: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '6px' },
  chips: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2px',
    height: '28px',
    padding: '0 2px 0 12px',
    borderRadius: tokens.borderRadiusCircular,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  number: { width: '64px' },
})

const DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0]
const dayName = (weekday: number) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, 10, 1 + weekday)), // 2026-11-01 is a Sunday
  )

/** Settings for the date + reminder picker. They're saved in the Microsoft account. */
export function DateReminderSettings() {
  const styles = useStyles()
  const [settings, update] = useDateSettings()
  const today = todayLocal()
  const [kind, setKind] = useState<CustomQuickDate['kind']>('days')
  const [amount, setAmount] = useState(3)
  const [weekday, setWeekday] = useState(3)
  const [newTime, setNewTime] = useState('20:00')

  const draft: CustomQuickDate = kind === 'weekday' ? { kind, weekday } : { kind, n: amount }
  const preview = customQuickDateDef('draft', draft)
  const full = settings.quickDates.length >= MAX_QUICK_DATES
  const last = settings.quickDates.length - 1

  return (
    <div className={styles.section}>
      <div className={styles.group}>
        <Subtitle2>Dates &amp; reminders</Subtitle2>
        <Caption1 className={styles.caption}>Saved in your Microsoft account, so every device uses the same shortcuts.</Caption1>
      </div>

      <div className={styles.group}>
        <span className={styles.label}>Quick dates</span>
        <Caption1 className={styles.caption} style={{ marginBottom: 4 }}>
          Shown in this order in the right-click menu, the date picker and on your phone.
        </Caption1>
        {settings.quickDates.map((entry, i) => {
          const def = quickDateDef(entry)
          if (!def) return null
          return (
            <div key={entry.id} className={styles.row}>
              <Checkbox
                checked={entry.on}
                aria-label={`Show ${def.label}`}
                onChange={() => update((s) => toggleQuickDate(s, entry.id))}
              />
              <QuickDateIcon visual={def.visual} day={Number(today.slice(8))} />
              <span className={`${styles.rowLabel} ${entry.on ? '' : styles.off}`}>{def.label}</span>
              <span className={styles.rule}>{def.rule}</span>
              <Button
                appearance="subtle"
                size="small"
                icon={<ChevronUpRegular />}
                aria-label={`Move ${def.label} up`}
                disabled={i === 0}
                onClick={() => update((s) => moveQuickDate(s, entry.id, -1))}
              />
              <Button
                appearance="subtle"
                size="small"
                icon={<ChevronDownRegular />}
                aria-label={`Move ${def.label} down`}
                disabled={i === last}
                onClick={() => update((s) => moveQuickDate(s, entry.id, 1))}
              />
              <Button
                appearance="subtle"
                size="small"
                icon={<DismissRegular />}
                aria-label={`Remove ${def.label}`}
                className={isBuiltIn(entry.id) ? styles.hidden : undefined}
                disabled={isBuiltIn(entry.id)}
                onClick={() => update((s) => removeQuickDate(s, entry.id))}
              />
            </div>
          )
        })}
        <div className={styles.add}>
          <Select
            size="small"
            aria-label="Kind of quick date"
            value={kind}
            onChange={(_, d) => setKind(d.value as CustomQuickDate['kind'])}
          >
            <option value="days">In … days</option>
            <option value="weeks">In … weeks</option>
            <option value="weekday">Next weekday</option>
          </Select>
          {kind === 'weekday' ? (
            <Select size="small" aria-label="Weekday" value={String(weekday)} onChange={(_, d) => setWeekday(Number(d.value))}>
              {DAY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {dayName(d)}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              size="small"
              type="number"
              className={styles.number}
              aria-label={kind === 'days' ? 'Days' : 'Weeks'}
              min={1}
              max={MAX_CUSTOM_AMOUNT}
              value={String(amount)}
              onChange={(_, d) => setAmount(Math.max(1, Math.min(MAX_CUSTOM_AMOUNT, Math.floor(Number(d.value)) || 1)))}
            />
          )}
          <Button
            size="small"
            icon={<AddRegular />}
            disabled={full}
            onClick={() => update((s) => addCustomQuickDate(s, draft, `c${crypto.randomUUID().slice(0, 8)}`))}
          >
            Add quick date
          </Button>
          <Caption1 className={styles.caption}>
            {full ? `Up to ${MAX_QUICK_DATES} quick dates` : `→ ${formatFullDate(preview.date(today), today)} today`}
          </Caption1>
        </div>
      </div>

      <div className={styles.group} style={{ gap: 6 }}>
        <span className={styles.label}>Reminder times</span>
        <div className={styles.chips}>
          {settings.reminderTimes.map((t) => (
            <span key={t} className={styles.chip}>
              {formatTimeOfDay(t)}
              <Button
                appearance="subtle"
                size="small"
                shape="circular"
                icon={<DismissRegular fontSize={12} />}
                aria-label={`Remove ${formatTimeOfDay(t)}`}
                onClick={() => update((s) => removeReminderTime(s, t))}
              />
            </span>
          ))}
          <Input
            size="small"
            type="time"
            aria-label="New reminder time"
            value={newTime}
            onChange={(_, d) => setNewTime(d.value)}
          />
          <Button
            size="small"
            disabled={!isTime(newTime) || settings.reminderTimes.includes(newTime) || settings.reminderTimes.length >= MAX_REMINDER_TIMES}
            onClick={() => update((s) => addReminderTime(s, newTime))}
          >
            Add
          </Button>
        </div>
        <Caption1 className={styles.caption}>Shown as chips after you pick a date. The clock chip sets any other time.</Caption1>
      </div>

      <Field label="When a task has no reminder yet">
        <RadioGroup
          value={settings.newReminder}
          onChange={(_, d) => update((s) => ({ ...s, newReminder: d.value === 'first' ? 'first' : 'none' }))}
        >
          <Radio value="none" label="Don't set a reminder" />
          <Radio
            value="first"
            label={`Preselect the first reminder time${settings.reminderTimes[0] ? ` (${formatTimeOfDay(settings.reminderTimes[0])})` : ''}`}
          />
        </RadioGroup>
      </Field>
    </div>
  )
}
