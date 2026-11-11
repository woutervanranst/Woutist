import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Button,
  Caption1,
  Divider,
  Input,
  Link,
  Menu,
  MenuItem,
  MenuItemCheckbox,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Spinner,
  Textarea,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
  useToastController,
  Toast,
  ToastTitle,
} from '@fluentui/react-components'
import { AlertRegular } from '@fluentui/react-icons/svg/alert'
import { ArrowDownRegular } from '@fluentui/react-icons/svg/arrow-down'
import { ArrowRepeatAllRegular } from '@fluentui/react-icons/svg/arrow-repeat-all'
import { ArrowUpRegular } from '@fluentui/react-icons/svg/arrow-up'
import { AttachRegular } from '@fluentui/react-icons/svg/attach'
import { CalendarLtrRegular } from '@fluentui/react-icons/svg/calendar-ltr'
import { CheckmarkCircleFilled } from '@fluentui/react-icons/svg/checkmark-circle'
import { CircleRegular } from '@fluentui/react-icons/svg/circle'
import { DeleteRegular } from '@fluentui/react-icons/svg/delete'
import { DismissRegular } from '@fluentui/react-icons/svg/dismiss'
import { DocumentRegular } from '@fluentui/react-icons/svg/document'
import { LinkRegular } from '@fluentui/react-icons/svg/link'
import { MoreHorizontalRegular } from '@fluentui/react-icons/svg/more-horizontal'
import { PanelRightContractRegular } from '@fluentui/react-icons/svg/panel-right-contract'
import { ReOrderDotsVerticalRegular } from '@fluentui/react-icons/svg/re-order-dots-vertical'
import { StarFilled, StarRegular } from '@fluentui/react-icons/svg/star'
import { TagRegular } from '@fluentui/react-icons/svg/tag'
import { useEffect, useRef, useState } from 'react'
import { useServices } from '../../app/AppServices'
import type { Step, Task } from '../../models/todo'
import { isTempId } from '../../models/todo'
import { todayLocal } from '../../models/time'
import { describeRecurrence, formatDate, formatFileSize, formatReminder } from '../../models/presets'
import { reminderLabel } from '../../models/dateReminder'
import { hasLink, splitLinks } from '../../models/linkify'
import { categoryColor } from '../common/categoryColors'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { RepeatMenu } from '../dates/RepeatMenu'
import { useDateEditor } from '../dates/useDateEditor'
import { useDatePicker } from '../dates/useDatePicker'
import { useAccountPrefs, useAttachments, useCategories, useCompactLayout, useTask } from '../hooks'

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  scroll: {
    flex: 1,
    overflowY: 'auto',
    padding: tokens.spacingHorizontalL,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
  },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow2,
    padding: tokens.spacingVerticalXS,
    display: 'flex',
    flexDirection: 'column',
  },
  titleRow: { display: 'flex', alignItems: 'flex-start', gap: tokens.spacingHorizontalXS, padding: tokens.spacingVerticalS },
  // Fluent applies a Textarea's font to its inner element, so the title weight goes on the slot.
  titleInput: { flex: 1, minWidth: 0 },
  // Measured against the Microsoft To Do Android app: cap height ~23px, Roboto Medium, ~31px lines.
  titleText: { fontSize: '23px', lineHeight: '31px', fontWeight: tokens.fontWeightMedium },
  // The title field's own padding, shared by the field and its link twin so they line up exactly.
  titleBox: { paddingTop: '4px', paddingBottom: '4px', paddingLeft: '10px', paddingRight: '10px' },
  // As tall as one title line plus the field's padding and border, so the circle and the star sit
  // on the centre of the first line however long the title grows.
  titleButton: { height: '41px', minWidth: '34px', alignSelf: 'flex-start' },
  // Read-only twin of the title field that shows web addresses as links; it mirrors the field's box.
  titleLinks: {
    flex: 1,
    minWidth: 0,
    boxSizing: 'border-box',
    border: '1px solid transparent',
    cursor: 'text',
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  titleLink: { fontWeight: 'inherit', fontSize: 'inherit', lineHeight: 'inherit' },
  done: { textDecoration: 'line-through' },
  // Circle (and "..." button) column shared by the title and the steps, so they line up.
  iconCell: { width: '34px', minWidth: '34px', flexShrink: 0 },
  stepCircle: { color: tokens.colorNeutralForeground4 },
  steps: { display: 'flex', flexDirection: 'column' },
  step: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    padding: `0 ${tokens.spacingVerticalS}`,
    minHeight: '40px',
  },
  // No box or underline: the steps read as plain lines of text, like in Microsoft To Do.
  stepInput: {
    flex: 1,
    minWidth: 0,
    backgroundColor: 'transparent',
    border: '1px solid transparent',
    // Brings the text flush with the title's text above.
    marginLeft: '-2px',
    '::after': { display: 'none' },
  },
  // The text of a step, on the textarea itself. Long steps wrap, and a long address breaks instead of
  // running off the pane. The side padding matches the old input, so the text stays where it was.
  stepText: {
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalM,
    overflowWrap: 'anywhere',
  },
  // Read-only twin of a step's textarea that shows web addresses as links; it mirrors the textarea's box.
  stepLinks: {
    flex: 1,
    minWidth: 0,
    boxSizing: 'border-box',
    border: '1px solid transparent',
    marginLeft: '-2px',
    paddingTop: tokens.spacingVerticalSNudge,
    paddingBottom: tokens.spacingVerticalSNudge,
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightRegular,
    lineHeight: tokens.lineHeightBase300,
    cursor: 'text',
    whiteSpace: 'pre-wrap',
  },
  stepLink: { fontWeight: 'inherit', fontSize: 'inherit', lineHeight: 'inherit' },
  stepDragging: {
    position: 'relative',
    zIndex: 1,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow8,
  },
  // Only the handle starts a drag, so the text of a step stays selectable and a tap still edits it.
  stepHandle: { color: tokens.colorNeutralForeground4, cursor: 'grab', touchAction: 'none' },
  newStepIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: tokens.colorNeutralForeground4,
  },
  action: {
    justifyContent: 'flex-start',
    width: '100%',
    minHeight: '44px',
    fontWeight: tokens.fontWeightRegular,
  },
  actionSet: { color: tokens.colorBrandForeground1 },
  actionText: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0, textAlign: 'left' },
  actionSub: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground3,
  },
  actionRow: { display: 'flex', alignItems: 'center' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalXS, padding: `0 ${tokens.spacingHorizontalM} ${tokens.spacingVerticalS}` },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralBackground3,
    fontSize: tokens.fontSizeBase200,
  },
  dot: { width: '8px', height: '8px', borderRadius: '50%' },
  attachment: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}` },
  attName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  footerText: { flex: 1, textAlign: 'center', color: tokens.colorNeutralForeground3 },
})

interface Props {
  taskId: string
  onClose: () => void
}

export function TaskDetailPane({ taskId, onClose }: Props) {
  const styles = useStyles()
  const task = useTask(taskId)
  const { engine } = useServices()

  // Load attachment metadata when a task with attachments is opened.
  useEffect(() => {
    if (task?.hasAttachments && !isTempId(task.id)) {
      void engine.refreshAttachments(task.listId, task.id).catch(() => {})
    }
  }, [engine, task?.id, task?.listId, task?.hasAttachments])

  if (task === undefined) return <Spinner style={{ marginTop: 64 }} />
  if (task === null) {
    return (
      <div className={styles.root}>
        <div className={styles.scroll}>This task no longer exists.</div>
        <div className={styles.footer}>
          <Button appearance="subtle" icon={<PanelRightContractRegular />} onClick={onClose} aria-label="Close details" />
        </div>
      </div>
    )
  }
  return <TaskDetails key={task.id} task={task} onClose={onClose} />
}

function TaskDetails({ task, onClose }: { task: Task; onClose: () => void }) {
  const styles = useStyles()
  const { repo } = useServices()
  const [prefs] = useAccountPrefs()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const update = (changes: Parameters<typeof repo.updateTask>[1]) => void repo.updateTask(task.id, changes)

  function remove() {
    onClose()
    void repo.deleteTask(task.id)
  }

  return (
    <aside className={styles.root} aria-label="Task details">
      <div className={styles.scroll}>
        <div className={styles.card}>
          <TitleEditor task={task} />
          <StepsEditor task={task} />
        </div>

        <div className={styles.card}>
          <DateReminderAction task={task} />
          <Divider />
          <RepeatAction task={task} onChange={update} />
        </div>

        <CategoriesCard task={task} onChange={update} />
        <AttachmentsCard task={task} />
        <NotesCard task={task} onChange={update} />
        {task.linkedResources.length > 0 && (
          <div className={styles.card}>
            {task.linkedResources.map((r) => (
              <div key={r.id} className={styles.attachment}>
                <LinkRegular />
                {r.webUrl ? (
                  <Link href={r.webUrl} target="_blank" rel="noreferrer" className={styles.attName}>
                    {r.displayName || r.applicationName || r.webUrl}
                  </Link>
                ) : (
                  <span className={styles.attName}>{r.displayName || r.applicationName}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={styles.footer}>
        <Tooltip content="Hide details" relationship="label">
          <Button appearance="subtle" icon={<PanelRightContractRegular />} onClick={onClose} />
        </Tooltip>
        <Caption1 className={styles.footerText}>
          {task.completed && task.completedDate
            ? `Completed ${formatDate(task.completedDate)}`
            : `Created ${formatDate(todayLocal(new Date(task.createdDateTime)))}`}
        </Caption1>
        <Tooltip content="Delete task" relationship="label">
          <Button
            appearance="subtle"
            icon={<DeleteRegular />}
            onClick={() => (prefs.confirmDelete ? setConfirmDelete(true) : remove())}
          />
        </Tooltip>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete task?"
        message={`"${task.title}" will be permanently deleted from Microsoft To Do.`}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          remove()
        }}
      />
    </aside>
  )
}

function TitleEditor({ task }: { task: Task }) {
  const styles = useStyles()
  const { repo } = useServices()
  const [title, setTitle] = useState(task.title)
  const [editing, setEditing] = useState(false)
  const focused = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!focused.current) setTitle(task.title)
  }, [task.title])
  // A pending save is deliberately not cancelled on unmount: if the pane closes before the field
  // blurs (e.g. Back on a phone) the edit is still saved. It only calls the repository, which
  // ignores no-op changes.
  const save = (value: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const next = value.trim()
    if (next && next !== task.title) void repo.updateTask(task.id, { title: next })
  }

  const commit = () => {
    focused.current = false
    setEditing(false)
    save(title)
    if (!title.trim()) setTitle(task.title)
  }

  // Web addresses show as links until the title is tapped; then the field takes over for editing.
  const showLinks = !editing && hasLink(title)

  return (
    <div className={styles.titleRow}>
      <Button
        className={styles.titleButton}
        appearance="transparent"
        shape="circular"
        aria-label={task.completed ? 'Mark as not completed' : 'Mark as completed'}
        icon={task.completed ? <CheckmarkCircleFilled fontSize={24} /> : <CircleRegular fontSize={24} />}
        onClick={() => void repo.toggleCompleted(task.id)}
      />
      {showLinks ? (
        <div
          className={mergeClasses(styles.titleLinks, styles.titleBox, styles.titleText, task.completed === 1 && styles.done)}
          role="textbox"
          aria-label="Task title"
          tabIndex={0}
          onFocus={(e) => e.target === e.currentTarget && setEditing(true)}
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('a')) setEditing(true)
          }}
        >
          {splitLinks(title).map((part, i) =>
            part.href ? (
              <Link key={i} href={part.href} target="_blank" rel="noreferrer" className={styles.titleLink}>
                {part.text}
              </Link>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </div>
      ) : (
        <Textarea
          className={styles.titleInput}
          appearance="filled-lighter"
          resize="none"
          rows={1}
          autoFocus={editing}
          // Grow with the title (CSS field-sizing; falls back to a single row elsewhere).
          textarea={{
            className: mergeClasses(styles.titleText, styles.titleBox, task.completed === 1 && styles.done),
            style: { fieldSizing: 'content', minHeight: 0 } as React.CSSProperties,
          }}
          value={title}
          aria-label="Task title"
          onFocus={() => (focused.current = true)}
          onChange={(_, d) => {
            const value = d.value.replace(/\n/g, '')
            setTitle(value)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => save(value), 1000)
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLTextAreaElement).blur()
            }
          }}
        />
      )}
      <Button
        className={styles.titleButton}
        appearance="transparent"
        aria-label={task.important ? 'Remove importance' : 'Mark as important'}
        icon={task.important ? <StarFilled /> : <StarRegular />}
        onClick={() => void repo.toggleImportant(task.id)}
      />
    </div>
  )
}

function StepsEditor({ task }: { task: Task }) {
  const styles = useStyles()
  const { repo } = useServices()
  const [newStep, setNewStep] = useState('')
  // Mirrors newStep so a submit and the blur that follows it can't both add the same step.
  const pending = useRef('')

  function setPending(value: string) {
    pending.current = value
    setNewStep(value)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const to = task.steps.findIndex((s) => s.id === over.id)
    if (to >= 0) void repo.reorderSteps(task.id, String(active.id), to)
  }

  function add() {
    const name = pending.current.trim()
    setPending('')
    if (name) void repo.addStep(task.id, name)
  }

  return (
    <div className={styles.steps}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={task.steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {task.steps.map((step, index) => (
            <StepRow
              key={`${step.id}:${step.displayName}`}
              task={task}
              step={step}
              index={index}
              count={task.steps.length}
            />
          ))}
        </SortableContext>
      </DndContext>
      {/* A form, so the Enter / Go key of any mobile keyboard adds the step (those often don't send a
          usable keydown). Leaving the field with text in it adds the step too. */}
      <form
        className={styles.step}
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <span className={mergeClasses(styles.iconCell, styles.newStepIcon)}>
          <CircleRegular fontSize={20} />
        </span>
        <Input
          className={styles.stepInput}
          appearance="filled-lighter"
          placeholder={task.steps.length ? 'Next step' : 'Add step'}
          value={newStep}
          aria-label="Add step"
          enterKeyHint="enter"
          autoComplete="off"
          onChange={(_, d) => setPending(d.value)}
          onBlur={add}
        />
      </form>
    </div>
  )
}

function StepRow({ task, step, index, count }: { task: Task; step: Step; index: number; count: number }) {
  const styles = useStyles()
  const { repo } = useServices()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
  })
  // Keyed by id + name, so an external rename resets this local edit state.
  const [name, setName] = useState(step.displayName)
  const [editing, setEditing] = useState(false)
  // Web addresses show as links until the step is tapped; then the textarea takes over for editing.
  const showLinks = !editing && hasLink(name)

  return (
    <div
      ref={setNodeRef}
      className={mergeClasses(styles.step, isDragging && styles.stepDragging)}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <Button
        className={styles.iconCell}
        appearance="transparent"
        size="small"
        shape="circular"
        aria-label={step.isChecked ? 'Uncheck step' : 'Check step'}
        icon={step.isChecked ? <CheckmarkCircleFilled fontSize={20} /> : <CircleRegular fontSize={20} className={styles.stepCircle} />}
        onClick={() => void repo.updateStep(task.id, step.id, { isChecked: !step.isChecked })}
      />
      {showLinks ? (
        <div
          className={mergeClasses(styles.stepLinks, styles.stepText, step.isChecked && styles.done)}
          role="textbox"
          aria-label="Step"
          tabIndex={0}
          onFocus={(e) => e.target === e.currentTarget && setEditing(true)}
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('a')) setEditing(true)
          }}
        >
          {splitLinks(name).map((part, i) =>
            part.href ? (
              <Link key={i} href={part.href} target="_blank" rel="noreferrer" className={styles.stepLink}>
                {part.text}
              </Link>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </div>
      ) : (
        <Textarea
          className={styles.stepInput}
          appearance="filled-lighter"
          resize="none"
          rows={1}
          autoFocus={editing}
          // Grows with the text (CSS field-sizing; falls back to a single row elsewhere), as the title does.
          textarea={{
            className: mergeClasses(styles.stepText, step.isChecked && styles.done),
            style: { fieldSizing: 'content', minHeight: 0 } as React.CSSProperties,
          }}
          value={name}
          aria-label="Step"
          onChange={(_, d) => setName(d.value.replace(/\n/g, ''))}
          onBlur={() => {
            setEditing(false)
            const next = name.trim()
            if (next && next !== step.displayName) void repo.updateStep(task.id, step.id, { displayName: next })
            else setName(step.displayName)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLTextAreaElement).blur()
            }
          }}
        />
      )}
      <Button
        ref={setActivatorNodeRef}
        className={mergeClasses(styles.iconCell, styles.stepHandle)}
        appearance="transparent"
        size="small"
        icon={<ReOrderDotsVerticalRegular />}
        aria-label="Move step"
        {...attributes}
        {...listeners}
      />
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Button
            className={styles.iconCell}
            appearance="transparent"
            size="small"
            icon={<MoreHorizontalRegular />}
            aria-label="Step options"
          />
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            {index > 0 && (
              <MenuItem icon={<ArrowUpRegular />} onClick={() => void repo.reorderSteps(task.id, step.id, index - 1)}>
                Move up
              </MenuItem>
            )}
            {index < count - 1 && (
              <MenuItem icon={<ArrowDownRegular />} onClick={() => void repo.reorderSteps(task.id, step.id, index + 1)}>
                Move down
              </MenuItem>
            )}
            <MenuItem icon={<DeleteRegular />} onClick={() => void repo.deleteStep(task.id, step.id)}>
              Delete step
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    </div>
  )
}

type OnChange = (changes: Parameters<ReturnType<typeof useServices>['repo']['updateTask']>[1]) => void

function DateReminderAction({ task }: { task: Task }) {
  const styles = useStyles()
  const editor = useDateEditor(task)
  const picker = useDatePicker(task, editor, useCompactLayout())
  const today = todayLocal()
  const reminder = reminderLabel(task, today)
  const isSet = Boolean(task.dueDate || reminder)
  const label = task.dueDate
    ? `Due ${formatDate(task.dueDate, today)}`
    : reminder
      ? `Remind me at ${formatReminder(task.reminderAt!, today)}`
      : 'Add date & reminder'
  return (
    <div className={styles.actionRow}>
      <Button
        appearance="transparent"
        icon={<CalendarLtrRegular />}
        className={mergeClasses(styles.action, isSet && styles.actionSet)}
        onClick={(e) => {
          editor.begin()
          picker.open(e.currentTarget)
        }}
      >
        <span className={styles.actionText}>
          <span>{label}</span>
          {task.dueDate && reminder && (
            <span className={styles.actionSub}>
              <AlertRegular fontSize={12} />
              Remind me at {reminder}
            </span>
          )}
        </span>
      </Button>
      {isSet && (
        <Tooltip content="Remove date and reminder" relationship="label">
          <Button
            appearance="transparent"
            icon={<DismissRegular />}
            onClick={() => {
              editor.begin()
              editor.pickDate(null)
              editor.end()
            }}
          />
        </Tooltip>
      )}
      {picker.element}
    </div>
  )
}

function RepeatAction({ task, onChange }: { task: Task; onChange: OnChange }) {
  const styles = useStyles()
  return (
    <div className={styles.actionRow}>
      <RepeatMenu task={task}>
        <Button
          appearance="transparent"
          icon={<ArrowRepeatAllRegular />}
          className={mergeClasses(styles.action, Boolean(task.recurrence) && styles.actionSet)}
        >
          {task.recurrence ? describeRecurrence(task.recurrence) : 'Repeat'}
        </Button>
      </RepeatMenu>
      {task.recurrence && (
        <Button
          appearance="transparent"
          icon={<DismissRegular />}
          aria-label="Remove Repeat"
          onClick={() => onChange({ recurrence: null })}
        />
      )}
    </div>
  )
}

function CategoriesCard({ task, onChange }: { task: Task; onChange: OnChange }) {
  const styles = useStyles()
  const categories = useCategories()
  const all = [
    ...categories,
    ...task.categories.filter((c) => !categories.some((x) => x.displayName === c)).map((displayName) => ({ displayName, color: 'none' })),
  ]
  return (
    <div className={styles.card}>
      <Menu
        checkedValues={{ categories: task.categories }}
        onCheckedValueChange={(_, d) => onChange({ categories: d.checkedItems })}
      >
        <MenuTrigger disableButtonEnhancement>
          <Button appearance="transparent" icon={<TagRegular />} className={styles.action}>
            {task.categories.length ? 'Categories' : 'Pick a category'}
          </Button>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            {all.length === 0 && <MenuItem disabled>No categories yet. Add some in Settings</MenuItem>}
            {all.map((c) => (
              <MenuItemCheckbox
                key={c.displayName}
                name="categories"
                value={c.displayName}
                icon={<span className={styles.dot} style={{ backgroundColor: categoryColor(c.color), display: 'inline-block' }} />}
              >
                {c.displayName}
              </MenuItemCheckbox>
            ))}
          </MenuList>
        </MenuPopover>
      </Menu>
      {task.categories.length > 0 && (
        <div className={styles.chipRow}>
          {task.categories.map((name) => (
            <span key={name} className={styles.chip}>
              <span
                className={styles.dot}
                style={{ backgroundColor: categoryColor(categories.find((c) => c.displayName === name)?.color) }}
              />
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function AttachmentsCard({ task }: { task: Task }) {
  const styles = useStyles()
  const { repo, engine } = useServices()
  const attachments = useAttachments(task.id)
  const fileInput = useRef<HTMLInputElement>(null)
  const { dispatchToast } = useToastController('app')

  async function open(attachmentId: string, name: string) {
    try {
      const blob = await engine.downloadAttachment(task.listId, task.id, attachmentId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch {
      dispatchToast(
        <Toast>
          <ToastTitle>Couldn't download {name}</ToastTitle>
        </Toast>,
        { intent: 'error' },
      )
    }
  }

  return (
    <div className={styles.card}>
      {attachments.map((a) => (
        <div key={a.id} className={styles.attachment}>
          <DocumentRegular />
          {isTempId(a.id) ? (
            <span className={styles.attName}>{a.name} (uploading…)</span>
          ) : (
            <Link className={styles.attName} onClick={() => void open(a.id, a.name)}>
              {a.name}
            </Link>
          )}
          <Caption1>{formatFileSize(a.size)}</Caption1>
          <Button
            appearance="transparent"
            size="small"
            icon={<DismissRegular />}
            aria-label={`Remove ${a.name}`}
            onClick={() => void repo.deleteAttachment(task.id, a.id)}
          />
        </div>
      ))}
      <Button
        appearance="transparent"
        icon={<AttachRegular />}
        className={styles.action}
        onClick={() => fileInput.current?.click()}
      >
        Add file
      </Button>
      <input
        ref={fileInput}
        type="file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          repo.addAttachment(task.id, file).catch((error: Error) =>
            dispatchToast(
              <Toast>
                <ToastTitle>{error.message}</ToastTitle>
              </Toast>,
              { intent: 'error' },
            ),
          )
        }}
      />
    </div>
  )
}

function NotesCard({ task, onChange }: { task: Task; onChange: OnChange }) {
  const styles = useStyles()
  const [notes, setNotes] = useState(task.body)
  const focused = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!focused.current) setNotes(task.body)
  }, [task.body])

  const save = (value: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (value !== task.body) onChange({ body: value })
  }

  return (
    <div className={styles.card}>
      <Textarea
        appearance="filled-lighter"
        resize="vertical"
        placeholder="Add note"
        value={notes}
        aria-label="Notes"
        textarea={{ style: { minHeight: 120 } }}
        onFocus={() => (focused.current = true)}
        onChange={(_, d) => {
          setNotes(d.value)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => save(d.value), 1500)
        }}
        onBlur={() => {
          focused.current = false
          save(notes)
        }}
      />
      {task.bodyHtml && (
        <Caption1 style={{ padding: '4px 8px' }}>
          This note came from an email and is shown as plain text. Editing saves it as plain text.
        </Caption1>
      )}
    </div>
  )
}
