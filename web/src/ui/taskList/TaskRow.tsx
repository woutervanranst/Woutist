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
import { CheckmarkCircleFilled } from '@fluentui/react-icons/svg/checkmark-circle'
import { CircleRegular } from '@fluentui/react-icons/svg/circle'
import { DeleteRegular } from '@fluentui/react-icons/svg/delete'
import { NoteRegular } from '@fluentui/react-icons/svg/note'
import { StarFilled, StarRegular } from '@fluentui/react-icons/svg/star'
import { type MouseEvent, memo } from 'react'
import type { Task, TodoList } from '../../models/todo'
import { addDays, todayLocal } from '../../models/time'
import { formatDate, formatReminder } from '../../models/presets'
import type { CategoryRecord } from '../../services/db'
import { categoryColor } from '../common/categoryColors'
import { listLabel } from '../common/ListIcon'

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
  overdue: { color: tokens.colorPaletteRedForeground1 },
  today: { color: tokens.colorBrandForeground1 },
  dot: { width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block' },
  star: { color: tokens.colorBrandForeground1 },
})

interface Props {
  task: Task
  list?: TodoList
  showListName: boolean
  selected: boolean
  pending: boolean
  lists: TodoList[]
  categories: CategoryRecord[]
  onSelect: (taskId: string) => void
  onToggleCompleted: (taskId: string) => void
  onToggleImportant: (taskId: string) => void
  onUpdateDue: (taskId: string, date: string | null) => void
  onMove: (taskId: string, listId: string) => void
  onDelete: (task: Task) => void
}

export const TaskRow = memo(function TaskRow(props: Props) {
  const { task, list, showListName, selected, pending, lists, categories } = props
  const styles = useStyles()
  const today = todayLocal()
  const stop = (e: MouseEvent) => e.stopPropagation()
  const checkedSteps = task.steps.filter((s) => s.isChecked).length

  const meta: React.ReactNode[] = []
  if (showListName && list) meta.push(<span key="list">{listLabel(list)}</span>)
  if (task.steps.length) {
    meta.push(
      <span key="steps">
        {checkedSteps} of {task.steps.length}
      </span>,
    )
  }
  if (task.dueDate) {
    const cls = !task.completed && task.dueDate < today ? styles.overdue : task.dueDate === today ? styles.today : undefined
    meta.push(
      <span key="due" className={mergeClasses(styles.metaItem, cls)}>
        <CalendarLtrRegular fontSize={14} />
        {formatDate(task.dueDate, today)}
        {task.recurrence && <ArrowRepeatAllRegular fontSize={14} aria-label="Repeats" />}
      </span>,
    )
  }
  if (task.isReminderOn && task.reminderAt) {
    meta.push(
      <span key="reminder" className={styles.metaItem}>
        <AlertRegular fontSize={14} />
        {formatReminder(task.reminderAt, today)}
      </span>,
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
    <Menu openOnContext>
      <MenuTrigger disableButtonEnhancement>
        <div
          role="button"
          tabIndex={0}
          aria-pressed={selected}
          className={mergeClasses(styles.row, selected && styles.selected)}
          onClick={() => props.onSelect(task.id)}
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
      <MenuPopover>
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
          <MenuItem icon={<CalendarLtrRegular />} onClick={() => props.onUpdateDue(task.id, today)}>
            Due today
          </MenuItem>
          <MenuItem icon={<CalendarLtrRegular />} onClick={() => props.onUpdateDue(task.id, addDays(today, 1))}>
            Due tomorrow
          </MenuItem>
          {task.dueDate && (
            <MenuItem icon={<CalendarLtrRegular />} onClick={() => props.onUpdateDue(task.id, null)}>
              Remove due date
            </MenuItem>
          )}
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
  )
})
