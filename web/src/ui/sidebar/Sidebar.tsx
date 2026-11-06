import {
  Button,
  Divider,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components'
import { AddRegular } from '@fluentui/react-icons/svg/add'
import { DeleteRegular } from '@fluentui/react-icons/svg/delete'
import { EditRegular } from '@fluentui/react-icons/svg/edit'
import { PeopleRegular } from '@fluentui/react-icons/svg/people'
import { type KeyboardEvent, useMemo, useState } from 'react'
import { NavLink, useNavigate } from 'react-router'
import { useServices } from '../../app/AppServices'
import type { TodoList } from '../../models/todo'
import { SMART_LISTS, tasksForView } from '../../models/views'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { ListIcon, SmartListIcon, listLabel } from '../common/ListIcon'
import { useAccountPrefs, useAllTasks, useLists, useToday } from '../hooks'

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    minWidth: 0,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  scroll: {
    flex: 1,
    overflowY: 'auto',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    minHeight: '40px',
    padding: `0 ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    color: tokens.colorNeutralForeground1,
    textDecoration: 'none',
    fontSize: tokens.fontSizeBase300,
    ':hover': { backgroundColor: tokens.colorNeutralBackground2Hover },
  },
  active: {
    backgroundColor: tokens.colorNeutralBackground2Selected,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorBrandForeground1,
  },
  label: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  count: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  footer: {
    padding: tokens.spacingHorizontalS,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  divider: { margin: `${tokens.spacingVerticalS} 0` },
})

interface Props {
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: Props) {
  const styles = useStyles()
  const { repo } = useServices()
  const navigate = useNavigate()
  const lists = useLists() ?? []
  const allTasks = useAllTasks()
  const [prefs] = useAccountPrefs()
  const today = useToday()
  const [newListName, setNewListName] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<TodoList | null>(null)

  const counts = useMemo(() => {
    const tasks = allTasks ?? []
    const perList = new Map<string, number>()
    for (const t of tasks) if (!t.completed) perList.set(t.listId, (perList.get(t.listId) ?? 0) + 1)
    return {
      perList,
      today: tasksForView({ kind: 'smart', id: 'today' }, tasks, today).open.length,
      important: tasksForView({ kind: 'smart', id: 'important' }, tasks).open.length,
      planned: tasksForView({ kind: 'smart', id: 'planned' }, tasks).open.length,
      all: tasksForView({ kind: 'smart', id: 'all' }, tasks).open.length,
      completed: 0,
    }
  }, [allTasks, today])

  const linkClass = ({ isActive }: { isActive: boolean }) => mergeClasses(styles.item, isActive && styles.active)

  async function createList() {
    const name = newListName?.trim()
    setNewListName(null)
    if (!name) return
    const id = await repo.createList(name)
    navigate(`/lists/${encodeURIComponent(id)}`)
    onNavigate?.()
  }

  async function commitRename() {
    if (renaming?.name.trim()) await repo.renameList(renaming.id, renaming.name)
    setRenaming(null)
  }

  const onNewListKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') void createList()
    if (e.key === 'Escape') setNewListName(null)
  }

  return (
    <nav className={styles.root} aria-label="Lists">
      <div className={styles.scroll}>
        {SMART_LISTS.filter((s) => prefs.smartLists[s.id]).map((s) => (
          <NavLink key={s.id} to={`/${s.id}`} className={linkClass} onClick={onNavigate}>
            <SmartListIcon id={s.id} />
            <span className={styles.label}>{s.label}</span>
            {counts[s.id] > 0 && <span className={styles.count}>{counts[s.id]}</span>}
          </NavLink>
        ))}
        <Divider className={styles.divider} />
        {lists.map((list) =>
          renaming?.id === list.id ? (
            <Input
              key={list.id}
              autoFocus
              value={renaming.name}
              onChange={(_, d) => setRenaming({ id: list.id, name: d.value })}
              onBlur={() => void commitRename()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename()
                if (e.key === 'Escape') setRenaming(null)
              }}
              aria-label="List name"
              style={{ width: '100%', margin: '4px 0' }}
            />
          ) : (
            <ListLink
              key={list.id}
              list={list}
              count={counts.perList.get(list.id) ?? 0}
              className={linkClass}
              labelClass={styles.label}
              countClass={styles.count}
              onNavigate={onNavigate}
              onRename={() => setRenaming({ id: list.id, name: list.displayName })}
              onDelete={() => setDeleting(list)}
            />
          ),
        )}
        {newListName !== null && (
          <Input
            autoFocus
            placeholder="List name (start with an emoji for an icon)"
            value={newListName}
            onChange={(_, d) => setNewListName(d.value)}
            onKeyDown={onNewListKey}
            onBlur={() => void createList()}
            aria-label="New list name"
            style={{ width: '100%', margin: '4px 0' }}
          />
        )}
      </div>
      <div className={styles.footer}>
        <Button
          appearance="subtle"
          icon={<AddRegular />}
          style={{ width: '100%', justifyContent: 'flex-start' }}
          onClick={() => setNewListName('')}
        >
          New list
        </Button>
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title="Delete list?"
        message={`"${deleting?.displayName}" and all its tasks will be permanently deleted from Microsoft To Do.`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const id = deleting!.id
          setDeleting(null)
          void repo.deleteList(id).then(() => navigate('/'))
        }}
      />
    </nav>
  )
}

function ListLink(props: {
  list: TodoList
  count: number
  className: (state: { isActive: boolean }) => string
  labelClass: string
  countClass: string
  onNavigate?: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const { list } = props
  const link = (
    <NavLink to={`/lists/${encodeURIComponent(list.id)}`} className={props.className} onClick={props.onNavigate}>
      <ListIcon list={list} />
      <span className={props.labelClass}>{listLabel(list)}</span>
      {list.isShared && (
        <Tooltip content="Shared list" relationship="label">
          <PeopleRegular fontSize={16} />
        </Tooltip>
      )}
      {props.count > 0 && <span className={props.countClass}>{props.count}</span>}
    </NavLink>
  )
  // Built-in lists (Tasks, Flagged email) can't be renamed or deleted.
  if (list.wellknownListName !== 'none') return link
  return (
    <Menu openOnContext>
      <MenuTrigger disableButtonEnhancement>{link}</MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem icon={<EditRegular />} onClick={props.onRename}>
            Rename list
          </MenuItem>
          <MenuItem icon={<DeleteRegular />} onClick={props.onDelete}>
            Delete list
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  )
}
