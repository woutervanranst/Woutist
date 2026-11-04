import {
  Button,
  Caption1,
  Divider,
  Input,
  Link,
  Menu,
  MenuDivider,
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
import {
  AlertRegular,
  ArrowRepeatAllRegular,
  ArrowUpRegular,
  AttachRegular,
  CalendarLtrRegular,
  CheckmarkCircleFilled,
  CircleRegular,
  DeleteRegular,
  DismissRegular,
  DocumentRegular,
  LinkRegular,
  MoreHorizontalRegular,
  PanelRightContractRegular,
  StarFilled,
  StarRegular,
  TagRegular,
} from '@fluentui/react-icons'
import { useEffect, useRef, useState } from 'react'
import { useServices } from '../../app/AppServices'
import type { Step, Task } from '../../models/todo'
import { isTempId } from '../../models/todo'
import { todayLocal } from '../../models/time'
import {
  type RepeatPreset,
  buildRecurrence,
  describeRecurrence,
  duePresets,
  formatDate,
  formatFileSize,
  formatReminder,
  recurrencePreset,
  reminderPresets,
} from '../../models/presets'
import { categoryColor } from '../common/categoryColors'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { useAccountPrefs, useAttachments, useCategories, useTask } from '../hooks'
import { CustomRepeatDialog, DateTimeDialog } from './pickers'

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
  titleInput: { flex: 1, fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold },
  done: { textDecoration: 'line-through' },
  step: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS, paddingLeft: tokens.spacingHorizontalS },
  stepInput: { flex: 1 },
  action: {
    justifyContent: 'flex-start',
    width: '100%',
    minHeight: '44px',
    fontWeight: tokens.fontWeightRegular,
  },
  actionSet: { color: tokens.colorBrandForeground1 },
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
          <ReminderAction task={task} onChange={update} />
          <Divider />
          <DueAction task={task} onChange={update} />
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
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setTitle(task.title)
  }, [task.title])

  const commit = () => {
    focused.current = false
    const next = title.trim()
    if (next && next !== task.title) void repo.updateTask(task.id, { title: next })
    else setTitle(task.title)
  }

  return (
    <div className={styles.titleRow}>
      <Button
        appearance="transparent"
        shape="circular"
        aria-label={task.completed ? 'Mark as not completed' : 'Mark as completed'}
        icon={task.completed ? <CheckmarkCircleFilled fontSize={24} /> : <CircleRegular fontSize={24} />}
        onClick={() => void repo.toggleCompleted(task.id)}
      />
      <Textarea
        className={mergeClasses(styles.titleInput, task.completed === 1 && styles.done)}
        appearance="filled-lighter"
        resize="none"
        rows={1}
        // Grow with the title (CSS field-sizing; falls back to a single row elsewhere).
        textarea={{ style: { fieldSizing: 'content', minHeight: 0 } as React.CSSProperties }}
        value={title}
        aria-label="Task title"
        onFocus={() => (focused.current = true)}
        onChange={(_, d) => setTitle(d.value.replace(/\n/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLTextAreaElement).blur()
          }
        }}
      />
      <Button
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

  return (
    <div>
      {task.steps.map((step) => (
        <StepRow key={`${step.id}:${step.displayName}`} task={task} step={step} />
      ))}
      <div className={styles.step}>
        <Input
          className={styles.stepInput}
          appearance="underline"
          contentBefore={<CircleRegular />}
          placeholder={task.steps.length ? 'Next step' : 'Add step'}
          value={newStep}
          aria-label="Add step"
          onChange={(_, d) => setNewStep(d.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newStep.trim()) {
              void repo.addStep(task.id, newStep)
              setNewStep('')
            }
          }}
        />
      </div>
    </div>
  )
}

function StepRow({ task, step }: { task: Task; step: Step }) {
  const styles = useStyles()
  const { repo } = useServices()
  // Keyed by id + name, so an external rename resets this local edit state.
  const [name, setName] = useState(step.displayName)

  return (
    <div className={styles.step}>
      <Button
        appearance="transparent"
        size="small"
        shape="circular"
        aria-label={step.isChecked ? 'Uncheck step' : 'Check step'}
        icon={step.isChecked ? <CheckmarkCircleFilled /> : <CircleRegular />}
        onClick={() => void repo.updateStep(task.id, step.id, { isChecked: !step.isChecked })}
      />
      <Input
        className={mergeClasses(styles.stepInput, step.isChecked && styles.done)}
        appearance="underline"
        value={name}
        aria-label="Step"
        onChange={(_, d) => setName(d.value)}
        onBlur={() => {
          const next = name.trim()
          if (next && next !== step.displayName) void repo.updateStep(task.id, step.id, { displayName: next })
          else setName(step.displayName)
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Button appearance="transparent" size="small" icon={<MoreHorizontalRegular />} aria-label="Step options" />
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem icon={<ArrowUpRegular />} onClick={() => void repo.promoteStep(task.id, step.id)}>
              Promote to task
            </MenuItem>
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

function ActionButton(props: {
  icon: React.ReactElement
  label: string
  isSet: boolean
  onClear?: () => void
}) {
  const styles = useStyles()
  return (
    <div className={styles.actionRow}>
      <MenuTrigger disableButtonEnhancement>
        <Button appearance="transparent" icon={props.icon} className={mergeClasses(styles.action, props.isSet && styles.actionSet)}>
          {props.label}
        </Button>
      </MenuTrigger>
      {props.isSet && props.onClear && (
        <Button appearance="transparent" icon={<DismissRegular />} aria-label={`Remove ${props.label}`} onClick={props.onClear} />
      )}
    </div>
  )
}

function ReminderAction({ task, onChange }: { task: Task; onChange: OnChange }) {
  const [picking, setPicking] = useState(false)
  const set = task.isReminderOn && task.reminderAt
  return (
    <>
      <Menu>
        <ActionButton
          icon={<AlertRegular />}
          label={set ? `Remind me at ${formatReminder(task.reminderAt!)}` : 'Remind me'}
          isSet={Boolean(set)}
          onClear={() => onChange({ reminderAt: null, isReminderOn: false })}
        />
        <MenuPopover>
          <MenuList>
            {reminderPresets().map((p) => (
              <MenuItem key={p.id} onClick={() => onChange({ reminderAt: p.at, isReminderOn: true })}>
                {p.label} <Caption1>&nbsp;{formatReminder(p.at)}</Caption1>
              </MenuItem>
            ))}
            <MenuDivider />
            <MenuItem onClick={() => setPicking(true)}>Pick a date & time</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      {picking && (
        <DateTimeDialog
          open
          title="Remind me"
          withTime
          initial={task.reminderAt}
          onSave={(at) => onChange({ reminderAt: at, isReminderOn: true })}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  )
}

function DueAction({ task, onChange }: { task: Task; onChange: OnChange }) {
  const [picking, setPicking] = useState(false)
  const today = todayLocal()
  return (
    <>
      <Menu>
        <ActionButton
          icon={<CalendarLtrRegular />}
          label={task.dueDate ? `Due ${formatDate(task.dueDate, today)}` : 'Add due date'}
          isSet={Boolean(task.dueDate)}
          onClear={() => onChange({ dueDate: null })}
        />
        <MenuPopover>
          <MenuList>
            {duePresets(today).map((p) => (
              <MenuItem key={p.id} onClick={() => onChange({ dueDate: p.date })}>
                {p.label} <Caption1>&nbsp;{formatDate(p.date, '')}</Caption1>
              </MenuItem>
            ))}
            <MenuDivider />
            <MenuItem onClick={() => setPicking(true)}>Pick a date</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      {picking && (
        <DateTimeDialog
          open
          title="Due date"
          withTime={false}
          initial={task.dueDate}
          onSave={(date) => onChange({ dueDate: date })}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  )
}

const REPEAT_LABELS: Record<RepeatPreset, string> = {
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
}

function RepeatAction({ task, onChange }: { task: Task; onChange: OnChange }) {
  const [custom, setCustom] = useState(false)
  const anchor = task.dueDate ?? todayLocal()
  const current = recurrencePreset(task.recurrence)
  return (
    <>
      <Menu>
        <ActionButton
          icon={<ArrowRepeatAllRegular />}
          label={task.recurrence ? describeRecurrence(task.recurrence) : 'Repeat'}
          isSet={Boolean(task.recurrence)}
          onClear={() => onChange({ recurrence: null })}
        />
        <MenuPopover>
          <MenuList>
            {(Object.keys(REPEAT_LABELS) as RepeatPreset[]).map((p) => (
              <MenuItem key={p} onClick={() => onChange({ recurrence: buildRecurrence(p, anchor), dueDate: anchor })}>
                {REPEAT_LABELS[p]}
                {current === p ? ' ✓' : ''}
              </MenuItem>
            ))}
            <MenuDivider />
            <MenuItem onClick={() => setCustom(true)}>Custom…</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      {custom && (
        <CustomRepeatDialog
          open
          onSave={(r) => onChange({ recurrence: buildRecurrence(r, anchor), dueDate: anchor })}
          onClose={() => setCustom(false)}
        />
      )}
    </>
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
            {all.length === 0 && <MenuItem disabled>No categories in your mailbox</MenuItem>}
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
