import { makeStyles, mergeClasses, tokens, useArrowNavigationGroup } from '@fluentui/react-components'
import { AlertRegular } from '@fluentui/react-icons/svg/alert'
import { useState } from 'react'
import { formatFullDate } from '../../models/dateReminder'
import { formatDate } from '../../models/presets'
import type { Task } from '../../models/todo'
import { HourChips } from './HourChips'
import { QuickDateIcon } from './QuickDateIcon'
import { useDateView } from './useDateView'
import type { DateEditor } from './useDateEditor'

const useStyles = makeStyles({
  head: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalS,
    padding: '6px 8px 2px',
    fontSize: tokens.fontSizeBase200,
  },
  title: { fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground2 },
  hint: { color: tokens.colorNeutralForeground3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  icons: { display: 'flex', flexWrap: 'wrap', gap: '2px', padding: '2px 2px 4px' },
  icon: {
    width: '38px',
    height: '38px',
    display: 'grid',
    placeItems: 'center',
    padding: 0,
    border: 'none',
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: 'transparent',
    cursor: 'pointer',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
    ':focus-visible': { outline: `2px solid ${tokens.colorStrokeFocus2}`, outlineOffset: '-2px' },
  },
  iconOn: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
    boxShadow: `inset 0 0 0 1.5px ${tokens.colorBrandStroke1}`,
  },
  hours: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    margin: '2px 2px 4px',
    padding: tokens.spacingHorizontalS,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  hoursHead: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 },
  strong: { fontWeight: tokens.fontWeightSemibold },
  muted: { color: tokens.colorNeutralForeground3 },
})

/**
 * The date part of a task's right-click menu: a row of quick-date icons. After picking one, a row of
 * reminder hours appears; picking an hour (or None) closes the menu.
 */
export function ContextDateSection(props: { task: Task; editor: DateEditor; onDone: () => void }) {
  const { task, editor } = props
  const styles = useStyles()
  const view = useDateView(task)
  const [hover, setHover] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ id: string; date: string } | null>(null)
  const arrows = useArrowNavigationGroup({ axis: 'horizontal', circular: true })

  const current = task.dueDate
    ? `${formatDate(task.dueDate, view.today)}${view.reminderLabel ? ` · ${view.reminderLabel}` : ''}`
    : 'No date'

  const icon = (key: string, label: string, on: boolean, content: React.ReactNode, onClick: () => void, hint: string) => (
    <button
      key={key}
      type="button"
      className={mergeClasses(styles.icon, on && styles.iconOn)}
      aria-label={label}
      aria-pressed={on}
      onMouseEnter={() => setHover(hint)}
      onMouseLeave={() => setHover(null)}
      onFocus={() => setHover(hint)}
      onBlur={() => setHover(null)}
      onClick={onClick}
    >
      {content}
    </button>
  )

  return (
    <div role="group" aria-label="Date">
      <div className={styles.head}>
        <span className={styles.title}>Date</span>
        <span className={styles.hint}>{hover ?? current}</span>
      </div>
      <div className={styles.icons} {...arrows}>
        {view.options.map((o) => {
          const date = formatFullDate(o.value, view.today)
          return icon(
            o.id,
            `${o.label}, ${date}`,
            picked ? picked.id === o.id : view.isPicked(o),
            <QuickDateIcon visual={o.visual} size={22} day={view.day} />,
            () => {
              editor.pickDate(o.value)
              setPicked({ id: o.id, date: o.value })
            },
            `${o.label} · ${date}`,
          )
        })}
        {task.dueDate &&
          icon('none', 'Remove date', false, <QuickDateIcon visual="none" size={22} />, () => {
            editor.pickDate(null)
            props.onDone()
          }, 'Remove date')}
      </div>
      {picked && (
        <div className={styles.hours}>
          <div className={styles.hoursHead}>
            <AlertRegular fontSize={14} />
            <span className={styles.strong}>Remind me</span>
            <span className={styles.muted}>on {formatFullDate(picked.date, view.today)}</span>
          </div>
          <HourChips
            size="small"
            times={view.settings.reminderTimes}
            value={view.reminderTime}
            onPick={(time) => {
              editor.pickTime(time)
              props.onDone()
            }}
          />
        </div>
      )}
    </div>
  )
}
