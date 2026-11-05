import { Button, OverlayDrawer, makeStyles, mergeClasses, tokens } from '@fluentui/react-components'
import { AlertRegular } from '@fluentui/react-icons/svg/alert'
import { ArrowRepeatAllRegular } from '@fluentui/react-icons/svg/arrow-repeat-all'
import { CalendarMonthRegular } from '@fluentui/react-icons/svg/calendar-month'
import { ChevronDownRegular } from '@fluentui/react-icons/svg/chevron-down'
import { ChevronRightRegular } from '@fluentui/react-icons/svg/chevron-right'
import { useState } from 'react'
import { quickDateHint } from '../../models/dateReminder'
import { describeRecurrence, formatDate } from '../../models/presets'
import type { Task } from '../../models/todo'
import { HourChips } from './HourChips'
import { MonthCalendar } from './MonthCalendar'
import { QuickDateIcon } from './QuickDateIcon'
import { RepeatMenu } from './RepeatMenu'
import { useDateView } from './useDateView'
import type { DateEditor } from './useDateEditor'

const useStyles = makeStyles({
  drawer: {
    height: 'auto',
    maxHeight: '92dvh',
    width: '100%',
    borderTopLeftRadius: '16px',
    borderTopRightRadius: '16px',
    boxShadow: tokens.shadow28,
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 16px max(20px, env(safe-area-inset-bottom))',
    overflowY: 'auto',
  },
  handle: { alignSelf: 'center', width: '32px', height: '4px', borderRadius: '2px', backgroundColor: tokens.colorNeutralStroke1 },
  head: { display: 'flex', alignItems: 'flex-start', gap: tokens.spacingHorizontalS },
  headText: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  title: {
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
    fontWeight: tokens.fontWeightSemibold,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sub: { fontSize: tokens.fontSizeBase200, lineHeight: tokens.lineHeightBase200, color: tokens.colorNeutralForeground3 },
  done: { color: tokens.colorBrandForeground1, flexShrink: 0 },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: tokens.spacingHorizontalS },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
    height: '76px',
    padding: '4px',
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    fontFamily: 'inherit',
    cursor: 'pointer',
    ':focus-visible': { outline: `2px solid ${tokens.colorStrokeFocus2}` },
  },
  tileOn: { border: `2px solid ${tokens.colorBrandStroke1}`, backgroundColor: tokens.colorBrandBackground2 },
  tileLabel: { fontSize: '13px', lineHeight: '18px', fontWeight: tokens.fontWeightSemibold, textAlign: 'center' },
  tileHint: { fontSize: tokens.fontSizeBase100, lineHeight: '14px', color: tokens.colorNeutralForeground3 },
  remind: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    padding: '10px 12px',
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  remindPicked: { backgroundColor: tokens.colorBrandBackground2 },
  remindHead: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: tokens.colorNeutralForeground2 },
  strong: { fontWeight: tokens.fontWeightSemibold },
  muted: { color: tokens.colorNeutralForeground3 },
  rows: { display: 'flex', flexDirection: 'column', margin: '-4px -4px 0' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    height: '48px',
    padding: '0 8px',
    border: 'none',
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForeground1,
    fontFamily: 'inherit',
    fontSize: tokens.fontSizeBase300,
    textAlign: 'left',
    cursor: 'pointer',
  },
  rowLabel: { flex: 1 },
  divider: { height: '1px', backgroundColor: tokens.colorNeutralStroke2, margin: '0 8px' },
  chevron: { color: tokens.colorNeutralForeground3, transitionProperty: 'transform', transitionDuration: tokens.durationFast },
  open: { transform: 'rotate(180deg)' },
  calendar: { padding: '0 4px 8px' },
})

/** The date + reminder picker as a bottom sheet (phones). */
export function DateReminderSheet(props: { task: Task; editor: DateEditor; calendarOpen?: boolean; onClose: () => void }) {
  const { task, editor, onClose } = props
  const styles = useStyles()
  const view = useDateView(task)
  const [calendarOpen, setCalendarOpen] = useState(Boolean(props.calendarOpen))
  const [picked, setPicked] = useState(false)
  const current = task.dueDate
    ? `${formatDate(task.dueDate, view.today)} · ${view.reminderLabel ? `reminder at ${view.reminderLabel}` : 'no reminder'}`
    : view.reminderLabel
      ? `Reminder at ${view.reminderLabel}`
      : 'No date'

  const pickDate = (date: string) => {
    editor.pickDate(date)
    setPicked(true)
  }

  return (
    <OverlayDrawer
      open
      position="bottom"
      className={styles.drawer}
      aria-label="Date and reminder"
      onOpenChange={(_, d) => !d.open && onClose()}
    >
      <div className={styles.body}>
        <div className={styles.handle} aria-hidden />
        <div className={styles.head}>
          <div className={styles.headText}>
            <span className={styles.title}>{task.title}</span>
            <span className={styles.sub}>{current}</span>
          </div>
          <Button appearance="transparent" className={styles.done} onClick={onClose}>
            Done
          </Button>
        </div>

        <div className={styles.tiles} role="group" aria-label="Quick dates">
          {view.options.map((o) => (
            <button
              key={o.id}
              type="button"
              className={mergeClasses(styles.tile, view.isPicked(o) && styles.tileOn)}
              aria-pressed={view.isPicked(o)}
              aria-label={`${o.label}, ${quickDateHint(o.value, view.today)}`}
              onClick={() => pickDate(o.value)}
            >
              <QuickDateIcon visual={o.visual} size={26} day={view.day} />
              <span className={styles.tileLabel}>{o.short}</span>
              <span className={styles.tileHint}>{quickDateHint(o.value, view.today)}</span>
            </button>
          ))}
        </div>

        <div className={mergeClasses(styles.remind, picked && styles.remindPicked)}>
          <div className={styles.remindHead}>
            <AlertRegular fontSize={16} />
            <span className={styles.strong}>Remind me</span>
            <span className={styles.muted}>{view.remindHint}</span>
          </div>
          <HourChips
            size="large"
            times={view.settings.reminderTimes}
            value={view.reminderTime}
            onPick={(time) => {
              editor.pickTime(time)
              onClose()
            }}
          />
        </div>

        <div className={styles.rows}>
          <button type="button" className={styles.row} aria-expanded={calendarOpen} onClick={() => setCalendarOpen((o) => !o)}>
            <CalendarMonthRegular fontSize={20} />
            <span className={styles.rowLabel}>Pick a date</span>
            <ChevronDownRegular fontSize={16} className={mergeClasses(styles.chevron, calendarOpen && styles.open)} />
          </button>
          {calendarOpen && (
            <div className={styles.calendar}>
              <MonthCalendar large selected={task.dueDate} today={view.today} onPick={pickDate} />
            </div>
          )}
          <div className={styles.divider} />
          <RepeatMenu task={task}>
            <button type="button" className={styles.row}>
              <ArrowRepeatAllRegular fontSize={20} />
              <span className={styles.rowLabel}>{task.recurrence ? describeRecurrence(task.recurrence) : 'Repeat'}</span>
              <ChevronRightRegular fontSize={16} className={styles.muted} />
            </button>
          </RepeatMenu>
          {task.dueDate && (
            <>
              <div className={styles.divider} />
              <button
                type="button"
                className={styles.row}
                onClick={() => {
                  editor.pickDate(null)
                  onClose()
                }}
              >
                <QuickDateIcon visual="none" />
                <span className={styles.rowLabel}>Remove date</span>
              </button>
            </>
          )}
        </div>
      </div>
    </OverlayDrawer>
  )
}
