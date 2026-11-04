import {
  Button,
  Input,
  Menu,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import {
  AddRegular,
  ArrowSortRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  CircleRegular,
} from '@fluentui/react-icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useServices } from '../../app/AppServices'
import type { Task, TaskChanges } from '../../models/todo'
import { todayLocal } from '../../models/time'
import {
  PLANNED_GROUP_LABELS,
  SMART_LISTS,
  type SortKey,
  type ViewRef,
  groupPlanned,
  sortTasks,
  tasksForView,
  viewKey,
} from '../../models/views'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { ListIcon, SmartListIcon, listLabel } from '../common/ListIcon'
import {
  useAccountPrefs,
  useAllTasks,
  useCategories,
  useLists,
  usePendingTaskIds,
  useSelectedTask,
} from '../hooks'
import { TaskRow } from './TaskRow'

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXL} ${tokens.spacingVerticalS}`,
    color: tokens.colorBrandForeground1,
  },
  title: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  add: { padding: `0 ${tokens.spacingHorizontalXL} ${tokens.spacingVerticalS}` },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: `0 ${tokens.spacingHorizontalXL} ${tokens.spacingVerticalXXL}`,
  },
  section: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    margin: `${tokens.spacingVerticalM} 0 ${tokens.spacingVerticalXS}`,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
  },
  empty: {
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
    padding: `${tokens.spacingVerticalXXXL} ${tokens.spacingHorizontalL}`,
  },
})

const SORT_LABELS: Record<SortKey, string> = {
  default: 'Creation date (newest first)',
  importance: 'Importance',
  dueDate: 'Due date',
  title: 'Alphabetically',
  createdDateTime: 'Creation date (oldest first)',
}

interface Props {
  view: ViewRef
}

export function TaskListView({ view }: Props) {
  const styles = useStyles()
  const { repo } = useServices()
  const lists = useLists()
  const tasks = useAllTasks()
  const categories = useCategories()
  const pending = usePendingTaskIds()
  const [prefs, updatePrefs] = useAccountPrefs()
  const [selectedId, select] = useSelectedTask()
  const [newTitle, setNewTitle] = useState('')
  const [deleting, setDeleting] = useState<Task | null>(null)
  const addRef = useRef<HTMLInputElement>(null)
  const key = viewKey(view)

  const listsById = useMemo(() => new Map((lists ?? []).map((l) => [l.id, l])), [lists])
  const defaultList = lists?.find((l) => l.wellknownListName === 'defaultList')
  const currentList = view.kind === 'list' ? listsById.get(view.listId) : undefined

  const sortKey = prefs.sort[key]?.key ?? 'default'
  const sortDir = prefs.sort[key]?.dir ?? 'asc'
  const showCompleted = prefs.showCompleted[key] ?? view.kind !== 'list'

  const { open, completed } = useMemo(() => {
    const result = tasksForView(view, tasks ?? [])
    return {
      open: sortTasks(result.open, { key: sortKey, dir: sortDir }),
      completed: [...result.completed].sort((a, b) =>
        (b.completedDate ?? '').localeCompare(a.completedDate ?? ''),
      ),
    }
  }, [view, tasks, sortKey, sortDir])

  // Keyboard: "n" focuses the add-task box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, [contenteditable="true"]')) return
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        addRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handlers = {
    onSelect: useCallback((id: string) => select(id), [select]),
    onToggleCompleted: useCallback((id: string) => void repo.toggleCompleted(id), [repo]),
    onToggleImportant: useCallback((id: string) => void repo.toggleImportant(id), [repo]),
    onUpdateDue: useCallback((id: string, date: string | null) => void repo.updateTask(id, { dueDate: date }), [repo]),
    onMove: useCallback(
      (id: string, listId: string) =>
        void repo.moveTask(id, listId).then((newId) => {
          if (selectedId === id) select(newId)
        }),
      [repo, select, selectedId],
    ),
    onDelete: useCallback(
      (task: Task) => {
        if (prefs.confirmDelete) setDeleting(task)
        else void repo.deleteTask(task.id)
      },
      [prefs.confirmDelete, repo],
    ),
  }

  if (!lists || !tasks) return <Spinner style={{ marginTop: 64 }} />
  if (view.kind === 'list' && !currentList) {
    return <div className={styles.empty}>This list doesn't exist (anymore).</div>
  }

  const targetListId = view.kind === 'list' ? view.listId : defaultList?.id
  const canAdd = Boolean(targetListId) && view.kind !== 'search' && !(view.kind === 'smart' && view.id === 'completed')
  const isFlagged = currentList?.wellknownListName === 'flaggedEmails'

  async function addTask() {
    const title = newTitle.trim()
    if (!title || !targetListId) return
    const defaults: TaskChanges = {}
    if (view.kind === 'smart' && view.id === 'important') defaults.importance = 'high'
    if (view.kind === 'smart' && view.id === 'planned') defaults.dueDate = todayLocal()
    setNewTitle('')
    await repo.addTask(targetListId, title, defaults)
  }

  const title =
    view.kind === 'smart'
      ? SMART_LISTS.find((s) => s.id === view.id)!.label
      : view.kind === 'search'
        ? `Searching for "${view.query}"`
        : listLabel(currentList!)

  const rowProps = (task: Task) => ({
    task,
    list: listsById.get(task.listId),
    showListName: view.kind !== 'list',
    selected: task.id === selectedId,
    pending: pending.has(task.id),
    lists: lists ?? [],
    categories,
    ...handlers,
  })

  const planned = view.kind === 'smart' && view.id === 'planned'

  return (
    <section className={styles.root} aria-label={title}>
      <header className={styles.header}>
        {view.kind === 'list' ? <ListIcon list={currentList!} /> : <SmartListIcon id={view.kind === 'smart' ? view.id : 'search'} />}
        <Title2 as="h1" className={styles.title}>
          {title}
        </Title2>
        {!planned && view.kind !== 'search' && (
          <Menu
            checkedValues={{ sort: [sortKey] }}
            onCheckedValueChange={(_, d) =>
              updatePrefs((p) => ({
                ...p,
                sort: { ...p.sort, [key]: { key: d.checkedItems[0] as SortKey, dir: 'asc' } },
              }))
            }
          >
            <MenuTrigger disableButtonEnhancement>
              <Button appearance="subtle" icon={<ArrowSortRegular />}>
                Sort
              </Button>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <MenuItemRadio key={k} name="sort" value={k}>
                    {SORT_LABELS[k]}
                  </MenuItemRadio>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
        )}
      </header>

      {canAdd && !isFlagged && (
        <div className={styles.add}>
          <Input
            ref={addRef}
            size="large"
            appearance="filled-lighter"
            contentBefore={newTitle ? <CircleRegular /> : <AddRegular />}
            placeholder="Add a task"
            value={newTitle}
            onChange={(_, d) => setNewTitle(d.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addTask()
              if (e.key === 'Escape') setNewTitle('')
            }}
            aria-label="Add a task"
            style={{ width: '100%' }}
          />
        </div>
      )}

      <div className={styles.list}>
        {planned
          ? groupPlanned(open).map((g) => (
              <div key={g.group}>
                <div className={styles.section}>
                  {PLANNED_GROUP_LABELS[g.group]} <Text size={200}>({g.tasks.length})</Text>
                </div>
                {g.tasks.map((t) => (
                  <TaskRow key={t.id} {...rowProps(t)} />
                ))}
              </div>
            ))
          : open.map((t) => <TaskRow key={t.id} {...rowProps(t)} />)}

        {view.kind === 'smart' && view.id === 'completed'
          ? completed.map((t) => <TaskRow key={t.id} {...rowProps(t)} />)
          : completed.length > 0 && (
              <CompletedSection
                count={completed.length}
                expanded={showCompleted}
                onToggle={() =>
                  updatePrefs((p) => ({ ...p, showCompleted: { ...p.showCompleted, [key]: !showCompleted } }))
                }
              >
                {completed.map((t) => (
                  <TaskRow key={t.id} {...rowProps(t)} />
                ))}
              </CompletedSection>
            )}

        {open.length === 0 && completed.length === 0 && (
          <div className={styles.empty}>
            {view.kind === 'search'
              ? 'No tasks match your search.'
              : planned
                ? 'Tasks with due dates or reminders show up here.'
                : view.kind === 'smart' && view.id === 'important'
                  ? 'Star tasks to see them here.'
                  : 'Nothing here yet. Add a task above.'}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete task?"
        message={`"${deleting?.title}" will be permanently deleted from Microsoft To Do.`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const t = deleting!
          setDeleting(null)
          if (selectedId === t.id) select(null)
          void repo.deleteTask(t.id)
        }}
      />
    </section>
  )
}

function CompletedSection(props: {
  count: number
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const styles = useStyles()
  return (
    <div>
      <Button
        appearance="subtle"
        className={styles.section}
        icon={props.expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
        onClick={props.onToggle}
        aria-expanded={props.expanded}
      >
        Completed {props.count}
      </Button>
      {props.expanded && props.children}
    </div>
  )
}
