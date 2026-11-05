import {
  Button,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components'
import { AlertRegular } from '@fluentui/react-icons/svg/alert'
import { ArrowMoveRegular } from '@fluentui/react-icons/svg/arrow-move'
import { ArrowRepeatAllRegular } from '@fluentui/react-icons/svg/arrow-repeat-all'
import { ArrowSyncRegular } from '@fluentui/react-icons/svg/arrow-sync'
import { AttachRegular } from '@fluentui/react-icons/svg/attach'
import { CalendarLtrRegular } from '@fluentui/react-icons/svg/calendar-ltr'
import { CalendarMonthRegular } from '@fluentui/react-icons/svg/calendar-month'
import { CheckmarkCircleFilled } from '@fluentui/react-icons/svg/checkmark-circle'
import { CircleRegular } from '@fluentui/react-icons/svg/circle'
import { DeleteRegular } from '@fluentui/react-icons/svg/delete'
import { NoteRegular } from '@fluentui/react-icons/svg/note'
import { StarFilled, StarRegular } from '@fluentui/react-icons/svg/star'
import { type KeyboardEvent, type MouseEvent, memo, useRef, useState } from 'react'
import type { Task, TodoList } from '../../models/todo'
import { todayLocal } from '../../models/time'
import { formatDate, formatReminder } from '../../models/presets'
import { reminderLabel } from '../../models/dateReminder'
import type { CategoryRecord } from '../../services/db'
import { categoryColor } from '../common/categoryColors'
import { listLabel } from '../common/ListIcon'
import { ContextDateSection } from '../dates/ContextDateSection'
import { useDateEditor } from '../dates/useDateEditor'
import { useDatePicker } from '../dates/useDatePicker'

const useStyles = makeStyles({
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    minHeight: '52px',
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    marginBottom: '2px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    cursor: 'pointer',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  selected: {
    backgroundColor: tokens.colorBrandBackground2,
    ':hover': { backgroundColor: tokens.colorBrandBackground2Hover },
  },
  main: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' },
  title: {
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  done: { textDecoration: 'line-through', color: tokens.colorNeutralForeground3 },
  meta: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalS,
    rowGap: '2px',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  metaItem: { display: 'inline-flex', alignItems: 'center', gap: '3px' },
  dateChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    margin: '-2px -4px',
    padding: '2px 4px',
    border: 'none',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: 'transparent',
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    cursor: 'pointer',
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundPressed },
    ':focus-visible': { outline: `2px solid ${tokens.colorStrokeFocus2}` },
  },
  addDate: { color: tokens.colorNeutralForeground4 },
  reminderPart: { display: 'inline-flex', alignItems: 'center', gap: '3px', marginLeft: '3px' },
  overdue: { color: tokens.colorPaletteRedForeground1 },
  today: { color: tokens.colorBrandForeground1 },
  dot: { width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block' },
  star: { color: tokens.colorBrandForeground1 },
  menu: { width: '296px', maxWidth: 'calc(100vw - 16px)', boxSizing: 'border-box' },
})

interface Props {
  task: Task
  list?: TodoList
  showListName: boolean
  selected: boolean
  pending: boolean
  lists: TodoList[]
  categories: CategoryRecord[]
  /** Phone-sized layout: the date picker opens as a bottom sheet. */
  compact: boolean
  onSelect: (taskId: string) => void
  onToggleCompleted: (taskId: string) => void
  onToggleImportant: (taskId: string) => void
  onMove: (taskId: string, listId: string) => void
  onDelete: (task: Task) => void
}

export const TaskRow = memo(function TaskRow(props: Props) {
  const { task, list, showListName, selected, pending, lists, categories } = props
  const styles = useStyles()
  const today = todayLocal()
  const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation()
  const checkedSteps = task.steps.filter((s) => s.isChecked).length

  const editor = useDateEditor(task)
  const picker = useDatePicker(task, editor, props.compact)
  const [menuOpen, setMenuOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const menuPoint = useRef<{ x: number; y: number } | null>(null)
  // The right-click menu hands its editing session over to the full picker ("Pick a date…").
  const handingOver = useRef(false)

  const closeMenu = () => {
    setMenuOpen(false)
    editor.end()
  }
  const openFullPicker = () => {
    handingOver.current = true
    setMenuOpen(false)
    const from = menuPoint.current ?? rowRef.current
    if (from) picker.open(from, { calendar: true })
  }

  const meta: React.ReactNode[] = []
  if (showListName && list) meta.push(<span key="list">{listLabel(list)}</span>)
  if (task.steps.length) {
    meta.push(
      <span key="steps">
        {checkedSteps} of {task.steps.length}
      </span>,
    )
  }
  const reminder = reminderLabel(task, today)
  if (task.dueDate || reminder || !task.completed) {
    const cls = task.dueDate
      ? !task.completed && task.dueDate < today
        ? styles.overdue
        : task.dueDate === today
          ? styles.today
          : undefined
      : !reminder && styles.addDate
    meta.push(
      <button
        key="date"
        type="button"
        className={mergeClasses(styles.dateChip, cls)}
        aria-label={
          task.dueDate || reminder
            ? `Change date or reminder: ${[task.dueDate && `due ${formatDate(task.dueDate, today)}`, reminder && `reminder ${reminder}`]
                .filter(Boolean)
                .join(', ')}`
            : 'Add date'
        }
        onClick={(e) => {
          stop(e)
          editor.begin()
          picker.open(e.currentTarget)
        }}
        onKeyDown={stop}
      >
        {task.dueDate ? (
          <>
            <CalendarLtrRegular fontSize={14} />
            {formatDate(task.dueDate, today)}
            {reminder && (
              <span className={styles.reminderPart}>
                <AlertRegular fontSize={13} />
                {reminder}
              </span>
            )}
            {task.recurrence && <ArrowRepeatAllRegular fontSize={14} aria-label="Repeats" />}
          </>
        ) : reminder ? (
          <>
            <AlertRegular fontSize={14} />
            {formatReminder(task.reminderAt!, today)}
          </>
        ) : (
          <>
            <CalendarLtrRegular fontSize={14} />
            Add date
          </>
        )}
      </button>,
    )
  }
  if (task.hasAttachments) {
    meta.push(
      <span key="att" className={styles.metaItem} aria-label="Has attachments">
        <AttachRegular fontSize={14} />
      </span>,
    )
  }
  if (task.body.trim()) {
    meta.push(
      <span key="note" className={styles.metaItem} aria-label="Has notes">
        <NoteRegular fontSize={14} />
      </span>,
    )
  }
  for (const name of task.categories) {
    const color = categories.find((c) => c.displayName === name)?.color
    meta.push(
      <span key={`cat:${name}`} className={styles.metaItem}>
        <span className={styles.dot} style={{ backgroundColor: categoryColor(color) }} />
        {name}
      </span>,
    )
  }
  if (pending) {
    meta.push(
      <Tooltip key="pending" content="Waiting to sync" relationship="label">
        <span className={styles.metaItem}>
          <ArrowSyncRegular fontSize={14} />
        </span>
      </Tooltip>,
    )
  }

  return (
    <>
      <Menu
        openOnContext
        open={menuOpen}
        onOpenChange={(_, d) => {
          setMenuOpen(d.open)
          if (d.open) {
            handingOver.current = false
            editor.begin()
          } else if (handingOver.current) {
            handingOver.current = false
          } else {
            editor.end()
          }
        }}
      >
        <MenuTrigger disableButtonEnhancement>
          <div
            ref={rowRef}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            className={mergeClasses(styles.row, selected && styles.selected)}
            onClick={() => props.onSelect(task.id)}
            onContextMenu={(e) => {
              // Keyboard-opened menus (Shift+F10) report 0,0: anchor the picker on the row then.
              menuPoint.current = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : null
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.onSelect(task.id)
            }}
          >
            <Button
              appearance="transparent"
              shape="circular"
              aria-label={task.completed ? 'Mark as not completed' : 'Mark as completed'}
              icon={
                task.completed ? (
                  <CheckmarkCircleFilled fontSize={22} className={styles.star} />
                ) : (
                  <CircleRegular fontSize={22} />
                )
              }
              onClick={(e) => {
                stop(e)
                props.onToggleCompleted(task.id)
              }}
            />
            <div className={styles.main}>
              <span className={mergeClasses(styles.title, task.completed === 1 && styles.done)}>{task.title}</span>
              {meta.length > 0 && <div className={styles.meta}>{meta}</div>}
            </div>
            <Button
              appearance="transparent"
              aria-label={task.important ? 'Remove importance' : 'Mark as important'}
              icon={task.important ? <StarFilled className={styles.star} /> : <StarRegular />}
              onClick={(e) => {
                stop(e)
                props.onToggleImportant(task.id)
              }}
            />
          </div>
        </MenuTrigger>
        <MenuPopover
          className={styles.menu}
          onKeyDown={(e) => {
            const inField = (e.target as HTMLElement).closest('input, textarea')
            if (!inField && (e.key === 't' || e.key === 'T') && !e.metaKey && !e.ctrlKey && !e.altKey) {
              e.preventDefault()
              openFullPicker()
            }
          }}
        >
          <MenuList>
            <MenuItem
              icon={task.important ? <StarFilled /> : <StarRegular />}
              onClick={() => props.onToggleImportant(task.id)}
            >
              {task.important ? 'Remove importance' : 'Mark as important'}
            </MenuItem>
            <MenuItem icon={<CheckmarkCircleFilled />} onClick={() => props.onToggleCompleted(task.id)}>
              {task.completed ? 'Mark as not completed' : 'Mark as completed'}
            </MenuItem>
            <MenuDivider />
            <ContextDateSection task={task} editor={editor} onDone={closeMenu} />
            <MenuItem icon={<CalendarMonthRegular />} secondaryContent="T" onClick={openFullPicker}>
              Pick a date…
            </MenuItem>
            <MenuDivider />
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <MenuItem icon={<ArrowMoveRegular />}>Move task to…</MenuItem>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  {lists
                    .filter((l) => l.id !== task.listId && l.wellknownListName !== 'flaggedEmails')
                    .map((l) => (
                      <MenuItem key={l.id} onClick={() => props.onMove(task.id, l.id)}>
                        {l.displayName}
                      </MenuItem>
                    ))}
                </MenuList>
              </MenuPopover>
            </Menu>
            <MenuDivider />
            <MenuItem icon={<DeleteRegular />} onClick={() => props.onDelete(task)}>
              Delete task
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      {picker.element}
    </>
  )
})
