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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router'
import { useServices, useSignOut } from '../../app/AppServices'
import { useMediaQuery } from '../../app/theme'
import { SMART_LISTS } from '../../models/views'
import { SettingsDialog } from '../settings/SettingsDialog'
import { NotificationSettings } from '../settings/NotificationSettings'
import { usePlatformNavigation } from '../../platform/navigation'
import { useInAppReminders } from './useInAppReminders'
import { Sidebar } from '../sidebar/Sidebar'
import { TaskDetailPane } from '../taskDetail/TaskDetailPane'
import { TaskListView } from '../taskList/TaskListView'
import { useHasUpcomingReminders, useLists, useSelectedTask, useSyncStatus } from '../hooks'
import { isNative } from '../../platform/native'
import { ReminderHealthBanner } from './ReminderHealthBanner'
import { SearchField } from './SearchField'

const useStyles = makeStyles({
  root: {
    height: '100dvh',
    display: 'grid',
    // Header, reminder banner (Android), body.
    gridTemplateRows: 'auto auto minmax(0, 1fr)',
    // Without an explicit minmax(0, …) column the grid grows to the widest unbreakable content
    // (long URL titles, the header's controls) and the page overflows the viewport.
    gridTemplateColumns: 'minmax(0, 1fr)',
    backgroundColor: tokens.colorNeutralBackground3,
    // Keep content clear of the status/navigation bars when drawn edge-to-edge (Android app).
    boxSizing: 'border-box',
    paddingTop: 'env(safe-area-inset-top, 0px)',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    paddingLeft: 'env(safe-area-inset-left, 0px)',
    paddingRight: 'env(safe-area-inset-right, 0px)',
  },
  // The drawer is portalled to <body>, outside the root's safe-area padding, so it needs its own
  // to keep the lists clear of the status bar and the navigation bar (edge-to-edge on Android).
  // The background matches Sidebar's so the padded strips don't show the drawer's default colour.
  // It is also sized to its content (within bounds): Fluent's fixed 320px left the lists in the
  // left 60% of a wide, empty drawer.
  drawer: {
    boxSizing: 'border-box',
    width: 'fit-content',
    minWidth: '240px',
    maxWidth: '85vw',
    paddingTop: 'env(safe-area-inset-top, 0px)',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    paddingLeft: 'env(safe-area-inset-left, 0px)',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    height: '48px',
    minWidth: 0,
    padding: `0 ${tokens.spacingHorizontalS}`,
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  brand: {
    flexShrink: 0,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400,
    padding: `0 ${tokens.spacingHorizontalS}`,
    '@media (max-width: 480px)': { display: 'none' },
  },
  search: { flex: '1 1 0', minWidth: 0, maxWidth: '420px', margin: '0 auto' },
  headerButton: { color: tokens.colorNeutralForegroundOnBrand, minWidth: '32px', flexShrink: 0 },
  body: { display: 'flex', minHeight: 0, minWidth: 0, overflow: 'hidden' },
  sidebar: { width: '280px', flexShrink: 0, borderRight: `1px solid ${tokens.colorNeutralStroke2}` },
  main: { flex: 1, minWidth: 0, minHeight: 0 },
  detail: { width: '380px', flexShrink: 0, borderLeft: `1px solid ${tokens.colorNeutralStroke2}`, minHeight: 0 },
  mobileDetail: { display: 'flex', flexDirection: 'column', height: '100%' },
})

export function AppShell() {
  const styles = useStyles()
  const { dispatchToast } = useToastController('app')
  usePlatformNavigation()
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

      {/* Always rendered so the body keeps the 1fr row. */}
      <div>{isNative && <NativeReminderBanner />}</div>

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
          className={styles.drawer}
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

// Views are passed as stable objects: a new one would make the list filter all tasks again, e.g.
// whenever a task is opened (`?task=`).
const SMART_VIEWS = SMART_LISTS.map(({ id }) => ({ kind: 'smart', id }) as const)

function ViewRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      {SMART_VIEWS.map((view) => (
        <Route key={view.id} path={`/${view.id}`} element={<TaskListView view={view} />} />
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
  const view = useMemo(() => ({ kind: 'list', listId }) as const, [listId])
  return <TaskListView view={view} />
}

function SearchRoute() {
  const [params] = useSearchParams()
  const query = params.get('q') ?? ''
  const view = useMemo(() => ({ kind: 'search', query }) as const, [query])
  return <TaskListView view={view} />
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
        <Button appearance="transparent" aria-label="Account" style={{ minWidth: 32, flexShrink: 0 }}>
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

function NativeReminderBanner() {
  const { accountKey } = useServices()
  return <ReminderHealthBanner accountKey={accountKey} active={useHasUpcomingReminders()} />
}
