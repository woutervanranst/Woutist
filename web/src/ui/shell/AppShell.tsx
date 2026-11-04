import { useAuth } from '../../auth/AuthContext'
import {
  Avatar,
  Button,
  Menu,
  MenuGroupHeader,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  OverlayDrawer,
  SearchBox,
  Spinner,
  Text,
  Toast,
  ToastTitle,
  Toaster,
  Tooltip,
  makeStyles,
  tokens,
  useToastController,
} from '@fluentui/react-components'
import { ArrowLeftRegular } from '@fluentui/react-icons/svg/arrow-left'
import { ArrowSyncRegular } from '@fluentui/react-icons/svg/arrow-sync'
import { CloudCheckmarkRegular } from '@fluentui/react-icons/svg/cloud-checkmark'
import { CloudOffRegular } from '@fluentui/react-icons/svg/cloud-off'
import { ErrorCircleRegular } from '@fluentui/react-icons/svg/error-circle'
import { NavigationRegular } from '@fluentui/react-icons/svg/navigation'
import { SettingsRegular } from '@fluentui/react-icons/svg/settings'
import { SignOutRegular } from '@fluentui/react-icons/svg/sign-out'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router'
import { useServices, useSignOut } from '../../app/AppServices'
import { useMediaQuery } from '../../app/theme'
import type { SmartListId } from '../../models/views'
import { SettingsDialog } from '../settings/SettingsDialog'
import { NotificationSettings } from '../settings/NotificationSettings'
import { useServiceWorkerNavigation } from '../../platform/pwa'
import { useInAppReminders } from './useInAppReminders'
import { Sidebar } from '../sidebar/Sidebar'
import { TaskDetailPane } from '../taskDetail/TaskDetailPane'
import { TaskListView } from '../taskList/TaskListView'
import { useLists, useSelectedTask, useSyncStatus } from '../hooks'

const useStyles = makeStyles({
  root: {
    height: '100dvh',
    display: 'grid',
    gridTemplateRows: 'auto 1fr',
    backgroundColor: tokens.colorNeutralBackground3,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    height: '48px',
    padding: `0 ${tokens.spacingHorizontalS}`,
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  brand: { fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase400, padding: `0 ${tokens.spacingHorizontalS}` },
  search: { flex: 1, maxWidth: '420px', margin: '0 auto' },
  headerButton: { color: tokens.colorNeutralForegroundOnBrand, minWidth: '32px' },
  body: { display: 'flex', minHeight: 0 },
  sidebar: { width: '280px', flexShrink: 0, borderRight: `1px solid ${tokens.colorNeutralStroke2}` },
  main: { flex: 1, minWidth: 0, minHeight: 0 },
  detail: { width: '380px', flexShrink: 0, borderLeft: `1px solid ${tokens.colorNeutralStroke2}`, minHeight: 0 },
  mobileDetail: { display: 'flex', flexDirection: 'column', height: '100%' },
})

export function AppShell() {
  const styles = useStyles()
  const { dispatchToast } = useToastController('app')
  useServiceWorkerNavigation()
  useInAppReminders(
    useCallback(
      (title: string) =>
        dispatchToast(
          <Toast>
            <ToastTitle>⏰ {title}</ToastTitle>
          </Toast>,
          { intent: 'info', timeout: 10_000 },
        ),
      [dispatchToast],
    ),
  )
  const desktop = useMediaQuery('(min-width: 900px)')
  const wide = useMediaQuery('(min-width: 1200px)')
  const [navOpen, setNavOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [taskId, select] = useSelectedTask()
  const searchRef = useRef<HTMLInputElement>(null)

  // Keyboard: "/" focuses search, Escape closes the details pane.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')
      if (e.key === '/' && !inField) {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape' && taskId && !inField) select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [taskId, select])

  const showSidebarInline = desktop
  const detailInline = desktop && taskId
  // On narrow desktop screens the details pane replaces the sidebar to leave room for the list.
  const hideSidebarForDetail = desktop && !wide && Boolean(taskId)

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        {(!showSidebarInline || hideSidebarForDetail) && (
          <Button
            appearance="transparent"
            className={styles.headerButton}
            icon={<NavigationRegular />}
            aria-label="Open lists"
            onClick={() => setNavOpen(true)}
          />
        )}
        <Text className={styles.brand}>Woutist</Text>
        <div className={styles.search}>
          <SearchField inputRef={searchRef} />
        </div>
        <SyncIndicator />
        <Tooltip content="Settings" relationship="label">
          <Button
            appearance="transparent"
            className={styles.headerButton}
            icon={<SettingsRegular />}
            onClick={() => setSettingsOpen(true)}
          />
        </Tooltip>
        <AccountMenu />
      </header>

      <div className={styles.body}>
        {showSidebarInline && !hideSidebarForDetail && (
          <div className={styles.sidebar}>
            <Sidebar />
          </div>
        )}
        <OverlayDrawer
          open={navOpen && (!showSidebarInline || hideSidebarForDetail)}
          onOpenChange={(_, d) => setNavOpen(d.open)}
          size="small"
        >
          <Sidebar onNavigate={() => setNavOpen(false)} />
        </OverlayDrawer>

        <main className={styles.main}>
          {!desktop && taskId ? (
            <div className={styles.mobileDetail}>
              <Button
                appearance="subtle"
                icon={<ArrowLeftRegular />}
                style={{ alignSelf: 'flex-start', margin: 4 }}
                onClick={() => select(null)}
              >
                Back
              </Button>
              <div style={{ flex: 1, minHeight: 0 }}>
                <TaskDetailPane taskId={taskId} onClose={() => select(null)} />
              </div>
            </div>
          ) : (
            <ViewRoutes />
          )}
        </main>

        {detailInline && (
          <div className={styles.detail}>
            <TaskDetailPane taskId={taskId!} onClose={() => select(null)} />
          </div>
        )}
      </div>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} extra={<NotificationSettings />} />
      <Toaster toasterId="app" position="bottom" />
      <SyncErrorToasts />
    </div>
  )
}

function ViewRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      {(['important', 'planned', 'all', 'completed'] as SmartListId[]).map((id) => (
        <Route key={id} path={`/${id}`} element={<TaskListView view={{ kind: 'smart', id }} />} />
      ))}
      <Route path="/lists/:listId" element={<ListRoute />} />
      <Route path="/search" element={<SearchRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function HomeRedirect() {
  const lists = useLists()
  const status = useSyncStatus()
  const defaultList = lists?.find((l) => l.wellknownListName === 'defaultList')
  if (defaultList) return <Navigate to={`/lists/${encodeURIComponent(defaultList.id)}`} replace />
  if (lists && lists.length > 0) return <Navigate to={`/lists/${encodeURIComponent(lists[0].id)}`} replace />
  if (status.state === 'error') return <Text style={{ padding: 24, display: 'block' }}>Couldn't load your lists: {status.error}</Text>
  return <Spinner label="Loading your lists…" style={{ marginTop: 64 }} />
}

function ListRoute() {
  const { listId = '' } = useParams()
  const { db } = useServices()
  const navigate = useNavigate()
  const lists = useLists()
  // Follow the id change when a list created offline gets its real id.
  useEffect(() => {
    if (!lists || lists.some((l) => l.id === listId)) return
    void db.getMeta<string>(`alias:${listId}`).then((real) => {
      if (real) navigate(`/lists/${encodeURIComponent(real)}${window.location.search}`, { replace: true })
    })
  }, [db, lists, listId, navigate])
  return <TaskListView view={{ kind: 'list', listId }} />
}

function SearchRoute() {
  const [params] = useSearchParams()
  return <TaskListView view={{ kind: 'search', query: params.get('q') ?? '' }} />
}

function SearchField({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [value, setValue] = useState(params.get('q') ?? '')
  const lastPath = useRef<string>('/')

  return (
    <SearchBox
      ref={inputRef}
      size="small"
      appearance="filled-lighter"
      placeholder="Search"
      aria-label="Search tasks"
      value={value}
      style={{ width: '100%', maxWidth: 'none' }}
      onChange={(_, d) => {
        setValue(d.value)
        if (d.value.trim()) {
          if (!window.location.pathname.startsWith('/search')) lastPath.current = window.location.pathname
          navigate(`/search?q=${encodeURIComponent(d.value)}`, { replace: window.location.pathname.startsWith('/search') })
        } else {
          navigate(lastPath.current)
        }
      }}
    />
  )
}

function SyncIndicator() {
  const status = useSyncStatus()
  const { engine } = useServices()
  const styles = useStyles()
  const pending = status.pendingChanges
  const [icon, label] =
    status.state === 'syncing'
      ? [<ArrowSyncRegular key="s" />, 'Syncing…']
      : status.state === 'offline'
        ? [<CloudOffRegular key="o" />, `Offline${pending ? ` · ${pending} change${pending === 1 ? '' : 's'} waiting` : ''}`]
        : status.state === 'error'
          ? [<ErrorCircleRegular key="e" />, `Sync problem: ${status.error ?? 'unknown error'}`]
          : [
              <CloudCheckmarkRegular key="i" />,
              status.lastSyncAt
                ? `Synced ${new Date(status.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${pending ? ` · ${pending} waiting` : ''}`
                : 'Not synced yet',
            ]
  return (
    <Tooltip content={`${label} (click to sync)`} relationship="label">
      <Button appearance="transparent" className={styles.headerButton} icon={icon} onClick={() => void engine.sync()} />
    </Tooltip>
  )
}

function SyncErrorToasts() {
  const status = useSyncStatus()
  const { dispatchToast } = useToastController('app')
  const last = useRef<string | null>(null)
  useEffect(() => {
    if (status.state === 'error' && status.error && status.error !== last.current) {
      last.current = status.error
      dispatchToast(
        <Toast>
          <ToastTitle>{status.error}</ToastTitle>
        </Toast>,
        { intent: 'error' },
      )
    }
    if (status.state === 'idle') last.current = null
  }, [status, dispatchToast])
  return null
}

function AccountMenu() {
  const { account } = useAuth()
  const { svc } = useServices()
  const [photo, setPhoto] = useState<string | undefined>()
  const [signingOut, setSigningOut] = useState(false)
  const signOut = useSignOut()

  useEffect(() => {
    let url: string | undefined
    void svc.getMyPhoto().then((blob) => {
      if (blob) {
        url = URL.createObjectURL(blob)
        setPhoto(url)
      }
    })
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [svc])

  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Button appearance="transparent" aria-label="Account" style={{ minWidth: 32 }}>
          <Avatar size={28} name={account?.name ?? account?.username} image={photo ? { src: photo } : undefined} />
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuGroupHeader>
            {account?.name}
            <br />
            {account?.username}
          </MenuGroupHeader>
          <MenuItem
            icon={<SignOutRegular />}
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true)
              void signOut()
            }}
          >
            Sign out
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  )
}
