import {
  Button,
  Popover,
  PopoverSurface,
  type PositioningVirtualElement,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components'
import { AlertRegular } from '@fluentui/react-icons/svg/alert'
import { ArrowRepeatAllRegular } from '@fluentui/react-icons/svg/arrow-repeat-all'
import { CalendarMonthRegular } from '@fluentui/react-icons/svg/calendar-month'
import { ChevronDownRegular } from '@fluentui/react-icons/svg/chevron-down'
import { ChevronRightRegular } from '@fluentui/react-icons/svg/chevron-right'
import { DismissRegular } from '@fluentui/react-icons/svg/dismiss'
import { useState } from 'react'
import { formatFullDate, quickDateHint } from '../../models/dateReminder'
import { describeRecurrence, formatDate } from '../../models/presets'
import type { Task } from '../../models/todo'
import { HourChips } from './HourChips'
import { MonthCalendar } from './MonthCalendar'
import { QuickDateIcon } from './QuickDateIcon'
import { RepeatMenu } from './RepeatMenu'
import type { DateEditor } from './useDateEditor'
import { useDateView } from './useDateView'

const useStyles = makeStyles({
  surface: {
    width: '300px',
    maxWidth: 'calc(100vw - 16px)',
    padding: 0,
    borderRadius: tokens.borderRadiusXLarge,
    overflowY: 'auto',
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: '12px 12px 10px 16px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  headerText: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  summary: { fontSize: tokens.fontSizeBase400, lineHeight: tokens.lineHeightBase400, fontWeight: tokens.fontWeightSemibold },
  summaryEmpty: { color: tokens.colorNeutralForeground3 },
  sub: { fontSize: tokens.fontSizeBase200, lineHeight: tokens.lineHeightBase200, color: tokens.colorNeutralForeground3 },
  section: { padding: '4px' },
  bordered: { borderTop: `1px solid ${tokens.colorNeutralStroke2}` },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    height: '32px',
    padding: '0 12px',
    border: 'none',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForeground1,
    fontFamily: 'inherit',
    fontSize: tokens.fontSizeBase300,
    textAlign: 'left',
    cursor: 'pointer',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
    ':focus-visible': { outline: `2px solid ${tokens.colorStrokeFocus2}`, outlineOffset: '-2px' },
  },
  rowOn: { backgroundColor: tokens.colorNeutralBackground1Selected, fontWeight: tokens.fontWeightSemibold },
  rowLabel: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  hint: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightRegular },
  muted: { color: tokens.colorNeutralForeground3 },
  calendar: { padding: '10px 12px 8px' },
  remind: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    padding: '10px 16px 12px',
    transitionProperty: 'background-color',
    transitionDuration: tokens.durationNormal,
  },
  remindPicked: { backgroundColor: tokens.colorBrandBackground2 },
  remindHead: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 },
  strong: { fontWeight: tokens.fontWeightSemibold },
})

/** The full date + reminder picker: quick dates, a calendar, reminder hours and repeat. */
export function DateReminderPanel(props: { task: Task; editor: DateEditor; onClose: () => void; calendarOpen?: boolean }) {
  const { task, editor, onClose } = props
  const styles = useStyles()
  const view = useDateView(task)
  const [calendarOpen, setCalendarOpen] = useState(Boolean(props.calendarOpen))
  const [picked, setPicked] = useState(false)

  const pickDate = (date: string) => {
    editor.pickDate(date)
    setPicked(true)
  }
  const clear = () => {
    editor.pickDate(null)
    onClose()
  }
  const sub = task.dueDate
    ? `${formatFullDate(task.dueDate, view.today)} · ${view.reminderLabel ? `reminder at ${view.reminderLabel}` : 'no reminder'}`
    : view.reminderLabel
      ? `Reminder at ${view.reminderLabel}`
      : 'Pick a date, then optionally an hour'

  return (
    <>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <span className={mergeClasses(styles.summary, !task.dueDate && styles.summaryEmpty)}>
            {task.dueDate ? formatDate(task.dueDate, view.today) : 'No date'}
          </span>
          <span className={styles.sub}>{sub}</span>
        </div>
        {task.dueDate && (
          <Button appearance="subtle" size="small" icon={<DismissRegular />} aria-label="Remove date and reminder" onClick={clear} />
        )}
      </div>

      <div className={styles.section} role="group" aria-label="Quick dates">
        {view.options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={mergeClasses(styles.row, view.isPicked(o) && styles.rowOn)}
            aria-pressed={view.isPicked(o)}
            onClick={() => pickDate(o.value)}
          >
            <QuickDateIcon visual={o.visual} day={view.day} />
            <span className={styles.rowLabel}>{o.label}</span>
            <span className={styles.hint}>{quickDateHint(o.value, view.today)}</span>
          </button>
        ))}
        {task.dueDate && (
          <button type="button" className={styles.row} onClick={clear}>
            <QuickDateIcon visual="none" />
            <span className={styles.rowLabel}>No date</span>
          </button>
        )}
      </div>

      <div className={mergeClasses(calendarOpen ? styles.calendar : styles.section, styles.bordered)}>
        {calendarOpen ? (
          <MonthCalendar selected={task.dueDate} today={view.today} onPick={pickDate} />
        ) : (
          <button type="button" className={styles.row} aria-expanded={false} onClick={() => setCalendarOpen(true)}>
            <CalendarMonthRegular fontSize={20} />
            <span className={styles.rowLabel}>Pick a date…</span>
            <ChevronDownRegular fontSize={16} className={styles.muted} />
          </button>
        )}
      </div>

      <div className={mergeClasses(styles.remind, styles.bordered, picked && styles.remindPicked)}>
        <div className={styles.remindHead}>
          <AlertRegular fontSize={14} />
          <span className={styles.strong}>Remind me</span>
          <span className={styles.muted}>{view.remindHint}</span>
        </div>
        <HourChips
          times={view.settings.reminderTimes}
          value={view.reminderTime}
          onPick={(time) => {
            editor.pickTime(time)
            onClose()
          }}
        />
      </div>

      <div className={mergeClasses(styles.section, styles.bordered)}>
        <RepeatMenu task={task}>
          <button type="button" className={styles.row} style={{ height: 36 }}>
            <ArrowRepeatAllRegular fontSize={20} />
            <span className={styles.rowLabel}>{task.recurrence ? describeRecurrence(task.recurrence) : 'Repeat'}</span>
            <ChevronRightRegular fontSize={16} className={styles.muted} />
          </button>
        </RepeatMenu>
      </div>
    </>
  )
}

/** The picker as a popover next to `target` (an element, or a point for the right-click menu). */
export function DateReminderPopover(props: {
  task: Task
  editor: DateEditor
  target: HTMLElement | PositioningVirtualElement
  calendarOpen?: boolean
  onClose: () => void
}) {
  const styles = useStyles()
  return (
    <Popover
      open
      trapFocus
      onOpenChange={(_, d) => !d.open && props.onClose()}
      // Stay below the target and slide up over it when the window is too short, rather than flipping
      // above (where there's usually even less room).
      positioning={{
        target: props.target,
        position: 'below',
        align: 'start',
        fallbackPositions: ['below-start'],
        shiftToCoverTarget: true,
        autoSize: 'height',
        offset: 4,
      }}
    >
      <PopoverSurface className={styles.surface} aria-label="Date and reminder">
        <DateReminderPanel task={props.task} editor={props.editor} onClose={props.onClose} calendarOpen={props.calendarOpen} />
      </PopoverSurface>
    </Popover>
  )
}
